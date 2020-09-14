---
layout: post
title: A better way of resolving EF Core interceptors with dependency injection
description: A quick post describing a much easier solution to resolve EF Core interceptors from a dependency injection container.
---

# Introduction

In a [previous post](/2020/07/17/connect-to-azure-sql-with-aad-and-managed-identities/), we looked at how we can connect to Azure SQL using Azure Active Directory authentication.
We first discussed a simple way of integrating this with EF Core, using interceptors.
Then, we had a look at [a solution](/2020/07/17/connect-to-azure-sql-with-aad-and-managed-identities/#:~:text=Going%20further:%20resolving%20interceptors%20with%20Dependency%20Injection) to resolve interceptors from the ASP.NET Core dependency injection container.

Unfortunately, that solution was complicated as it involved a lot of plumbing code and was stitching together the application service provider and the internal service provider used by EF Core.
All in all, while functional in my limited testing, I wasn't confident enough to be using it in production code.

The good news is that I found what I think is a much better solution!
No messing around with the internal service provider, no need to create an extension that is meant to be leveraged by third-party providers.
Just really simple, straightforward code.

Let's get to it.

## How to resolve EF Core interceptors from the dependency injection container

It's actually embarassing, given how straightforward it is.

While going through the different overloads of the `AddDbContext` method, I realised that several of them were accepting a delegate parameter that was given an instance of `IServiceProvider`.
That's great news, as it means we can have access to the application service provider while configuring the `DbContext` options.

To get some context, this is the initial solution we looked at, where we manually create an instance of our interceptor:

```csharp
public class Startup
{
    public Startup(IConfiguration configuration)
    {
        Configuration = configuration;
    }

    public IConfiguration Configuration { get; }

    public void ConfigureServices(IServiceCollection services)
    {
        services.AddDbContext<AppDbContext>(options =>
        {
            options.UseSqlServer(Configuration.GetConnectionString("<connection-string-name>"));
            options.AddInterceptors(new AadAuthenticationDbConnectionInterceptor());
        });
    }
}

public class AadAuthenticationDbConnectionInterceptor : DbConnectionInterceptor
{
    public override async Task<InterceptionResult> ConnectionOpeningAsync(
        DbConnection connection,
        ConnectionEventData eventData,
        InterceptionResult result,
        CancellationToken cancellationToken)
    {
        var sqlConnection = (SqlConnection)connection;

        //
        // Only try to get a token from AAD if
        //  - We connect to an Azure SQL instance; and
        //  - The connection doesn't specify a username.
        //
        var connectionStringBuilder = new SqlConnectionStringBuilder(sqlConnection.ConnectionString);
        if (connectionStringBuilder.DataSource.Contains("database.windows.net", StringComparison.OrdinalIgnoreCase) && string.IsNullOrEmpty(connectionStringBuilder.UserID))
        {
            sqlConnection.AccessToken = await GetAzureSqlAccessToken(cancellationToken);
        }

        return await base.ConnectionOpeningAsync(connection, eventData, result, cancellationToken);
    }

    private static async Task<string> GetAzureSqlAccessToken(CancellationToken cancellationToken)
    {
        // See https://docs.microsoft.com/en-us/azure/active-directory/managed-identities-azure-resources/services-support-managed-identities#azure-sql
        var tokenRequestContext = new TokenRequestContext(new[] { "https://database.windows.net//.default" });
        var tokenRequestResult = await new DefaultAzureCredential().GetTokenAsync(tokenRequestContext, cancellationToken);

        return tokenRequestResult.Token;
    }
}
```

Although this sample interceptor has no dependencies, we can update this sample to resolve it via the service provider:

```csharp
public class Startup
{
    public Startup(IConfiguration configuration)
    {
        Configuration = configuration;
    }

    public IConfiguration Configuration { get; }

    public void ConfigureServices(IServiceCollection services)
    {
        // 1. Register the interceptor in the dependency injection container
        services.AddSingleton<AadAuthenticationDbConnectionInterceptor>();

        // 2. Use one of the overload of AddDbContext that takes a parameter of type Action<IServiceProvider, DbContextOptionsBuilder>
        services.AddDbContext<AppDbContext>((provider, options) =>
        {
            options.UseSqlServer(Configuration.GetConnectionString("<connection-string-name>"));

            // 3. Resolve the interceptor from the service provider
            options.AddInterceptors(provider.GetRequiredService<AadAuthenticationDbConnectionInterceptor>());
        });
    }
}

public class AadAuthenticationDbConnectionInterceptor : DbConnectionInterceptor
{
    // Implementation ommitted for brevity
}
```

As mentioned before, this updated solution is orders of magnitude simpler than the initial one we went through.
I'm much more comfortable with it and I will happily use it in the applications I support.

## A note about the lifetime scopes of interceptors and their dependencies

I initially thought that the options associated with a `DbContext` were built once, meaning that the same instance would be used throughout the lifetime of the application.
However, it turns out that both the `DbContext` instance and its options are by default registered as scoped services.
In an ASP.NET Core application, it translates to new instances being constructed for each HTTP request.

The implication is that should we need it, our interceptors can be registered as scoped services without causing a [captive dependency problem](https://blog.ploeh.dk/2014/06/02/captive-dependency/), which is when a service with a "longer" lifetime,like a singleton, takes a dependency on a service with a "shorter" lifetime, like a scoped service.
Naturally, the same principle applies to the dependencies of our interceptors as well.

I'm yet to run into a situation where I need an interceptor to be defined as a scoped service, but it's good to know it's a possible option.

## The potential need to override both asynchronous and synchronous methods on interceptors

In the previous post mentioned in the introduction and the code snippet above, we define an EF Core interceptor that only overrides the `ConnectionOpeningAsync` method.

After introducing an AAD authentication interceptor in another project, I found that the `ConnectionOpeningAsync` method wasn't always invoked by EF Core.
I thought I had run into a bug, and started working on a minimal repro so I could open an issue on the EF Core GitHub repository.
While doing so, I realised it wasn't a bug, but a misconception on my part.

When interacting with the `DbContext` using asynchronous methods like `ToListAsync()`, `CountAsync`, and `AnyAsync`, EF Core will invoke the `ConnectionOpeningAsync` method on the registered interceptor.
However, when using their synchronous counterparts, the synchronous `ConnectionOpening` method will be called internally.
I didn't realise this in the first project I introduced interceptors in simply because this code base was consistently using asynchronous methods of the `DbContext`.

Fortunately, this was a simple fix as the [`TokenCredential` class](https://github.com/Azure/azure-sdk-for-net/blob/master/sdk/core/Azure.Core/src/TokenCredential.cs) from the Azure.Core NuGet package, that I leveraged to get an access token to connect to Azure SQL, exposes both a synchronous and asynchronous method to acquire a token.
After making the change, the interceptor looks like below:

```csharp
public class AadAuthenticationDbConnectionInterceptor : DbConnectionInterceptor
{
    // See https://docs.microsoft.com/en-us/azure/active-directory/managed-identities-azure-resources/services-support-managed-identities#azure-sql
    private static readonly string[] _azureSqlScopes = new[]
    {
        "https://database.windows.net//.default"
    };

    public override async Task<InterceptionResult> ConnectionOpeningAsync(
        DbConnection connection,
        ConnectionEventData eventData,
        InterceptionResult result,
        CancellationToken cancellationToken)
    {
        var sqlConnection = (SqlConnection)connection;
        if (ConnectionNeedsAccessToken(sqlConnection))
        {
            var tokenRequestContext = new TokenRequestContext(_azureSqlScopes);
            var token = await new DefaultAzureCredential().GetTokenAsync(tokenRequestContext, cancellationToken);
            sqlConnection.AccessToken = token.Token;
        }

        return await base.ConnectionOpeningAsync(connection, eventData, result, cancellationToken);
    }

    public override InterceptionResult ConnectionOpening(
        DbConnection connection,
        ConnectionEventData eventData,
        InterceptionResult result)
    {
        var sqlConnection = (SqlConnection)connection;
        if (ConnectionNeedsAccessToken(sqlConnection))
        {
            var tokenRequestContext = new TokenRequestContext(_azureSqlScopes);
            var token = new DefaultAzureCredential().GetToken(tokenRequestContext);
            sqlConnection.AccessToken = token.Token;
        }

        return base.ConnectionOpening(connection, eventData, result);
    }

    private static bool ConnectionNeedsAccessToken(SqlConnection connection)
    {
        //
        // Only try to get a token from AAD if
        //  - We connect to an Azure SQL instance; and
        //  - The connection doesn't specify a username.
        //
        var connectionStringBuilder = new SqlConnectionStringBuilder(connection.ConnectionString);

        return connectionStringBuilder.DataSource.Contains("database.windows.net", StringComparison.OrdinalIgnoreCase) && string.IsNullOrEmpty(connectionStringBuilder.UserID);
    }
}
```

## Conclusion

In this post, we first looked at a much simper and terser option to resolve our EF Core interceptors from the dependency injection container.
We then briefly discussed the lifetime scopes we can use for both our interceptors and their dependencies without running into issues.
Finally, we discovered that in some cases, we need to override both the synchronous and asynchronous methods of our interceptors.

Thanks ✌
