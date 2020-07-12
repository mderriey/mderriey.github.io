---
layout: post
title: How to connect to Azure SQL with AAD authentication and Managed Identities
description: How to connect to Azure SQL with AAD authentication and Managed Identities
---

# Introduction

We're trying to improve the security posture of our internal applications.

One aspect of this is how we deal with sensitive information, like database connection strings, API keys, or AAD client secrets.
The approach we're using is to store those in Key Vault instances, which can be accessed by the applications thanks to Azure Managed Identities.

In the case of Azure SQL, however, instead of storing the connection string in Key Vault, we've started using Managed Identities as well.
Instead of having a connection string with a SQL username and password, we use the application's identity to connect to Azure SQL directly.
We think this is more secure, because the less sensitive information to protect, the less chance of them being accessed by unauthorised parties.

In this post, we'll talk about how one can connect to Azure SQL using Azure Active Directory authentication, and how to do so using Entity Framework Core.

## Connecting to Azure SQL using Azure Active Directory authentication

As mentioned before, this approach doesn't use the traditional approach of having a connection string that contains a username and a password.
Instead, the credentials are replaced with an access token, much like you would use when you call an API.
Here's a simple example:

```csharp
public static async Task Main(string[] args)
{
    var connectionStringBuilder = new SqlConnectionStringBuilder
    {
        DataSource = "tcp:<azure-sql-instance-name>.database.windows.net,1433",
        InitialCatalog = "<azure-sql-database-name>",
        TrustServerCertificate = false,
        Encrypt = true
    };

    await using var sqlConnection = new SqlConnection(connectionStringBuilder.ConnectionString)
    {
        AccessToken = await GetAzureSqlAccessToken()
    };

    await sqlConnection.OpenAsync();
    var currentTime = await sqlConnection.ExecuteScalarAsync<DateTime>("SELECT GETDATE()");

    Console.WriteLine($"The time is now {currentTime.ToShortTimeString()}");
}

private static async Task<string> GetAzureSqlAccessToken()
{
    // See https://docs.microsoft.com/en-us/azure/active-directory/managed-identities-azure-resources/services-support-managed-identities#azure-sql
    var tokenRequestContext = new TokenRequestContext(new[] { "https://database.windows.net//.default" });
    var tokenRequestResult = await new DefaultAzureCredential().GetTokenAsync(tokenRequestContext);

    return tokenRequestResult.Token;
}
```

As previously mentioned, the connection string doesn't contain a username or a password, but an access token.

Acquiring the token is done with the help of the [Azure.Identity NuGet package](https://www.nuget.org/packages/Azure.Identity/) through the `DefaultAzureCredential` class.
The killer feature of that class is that it tries to acquire an access token from different sources, including:

- Using credentials exposed through environment variables;
- Using credentials of an Azure Managed Identity;
- Using the account that is logged in to Visual Studio;
- Using the account that is logged in to the Visual Studio Code Azure Account extension.

For more information, check out the [Azure SDK for .NET GitHub repository](https://github.com/Azure/azure-sdk-for-net/tree/master/sdk/identity/Azure.Identity).

## Integrating AAD authentication with Entity Framework Core

Many of our internal applications use Entity Framework Core to access data.
One impact is that the example shown above isn't viable anymore, because EF Core manages the lifetime of SQL connections, meaning it creates and disposes of connections internally.
While this is a big advantage, it means we need to find a way to "inject" an access token in the SQL connection before EF Core tries to use it.

The good news is that EF Core 3.0 introduced the concept of interceptors, which had been present in EF 6 for a long time.
Interestingly, I could only find a mention of this capability in the [release notes of EF Core 3.0](https://docs.microsoft.com/en-us/ef/core/what-is-new/ef-core-3.0/#interception-of-database-operations), but not in the EF Core docs.

The `AddInterceptors` method used in the example expects instances of `IInterceptor`, which is a marker interface, making it hard to discover types that implement it.
Using the decompiler of your choice &mdash; [ILSpy](https://github.com/icsharpcode/ILSpy) in my case &mdash; we can easily find them:

![Implementations of the IInterceptor interface](/public/images/posts/2020-07-11-azure-sql-aad-authentication/iinterceptor-implementations.png)

The `DbConnectionInterceptor` type seems like a fit.
Luckily, it exposes a [`ConnectionOpeningAsync`](https://docs.microsoft.com/en-us/dotnet/api/microsoft.entityframeworkcore.diagnostics.dbconnectioninterceptor.connectionopeningasync?view=efcore-3.1#Microsoft_EntityFrameworkCore_Diagnostics_DbConnectionInterceptor_ConnectionOpeningAsync_System_Data_Common_DbConnection_Microsoft_EntityFrameworkCore_Diagnostics_ConnectionEventData_Microsoft_EntityFrameworkCore_Diagnostics_InterceptionResult_System_Threading_CancellationToken_) method which sounds just like what we need!

Let's get to it, shall we?

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
            sqlConnection.AccessToken = await GetAzureSqlAccessToken();
        }

        return await base.ConnectionOpeningAsync(connection, eventData, result, cancellationToken);
    }

    private static async Task<string> GetAzureSqlAccessToken()
    {
        // See https://docs.microsoft.com/en-us/azure/active-directory/managed-identities-azure-resources/services-support-managed-identities#azure-sql
        var tokenRequestContext = new TokenRequestContext(new[] { "https://database.windows.net//.default" });
        var tokenRequestResult = await new DefaultAzureCredential().GetTokenAsync(tokenRequestContext);

        return tokenRequestResult.Token;
    }
}
```

The configuration of the EF Core `DbContext` is ordinary, with the exception of the registration of our interceptor.

The interceptor itself is straightforward as well; we can see that the way we acquire a token is similar to the previous example.
One interesting aspect is that we try to detect whether we even need to get an access token, based on the SQL Server instance we connect to, and whether the connection string specifies a username.

During local development, there's a high chance developers will connect to a local SQL database, so we don't need a token in this case.
Imagine also that for some reason, we revert back to using a connection string that contains a username and password; in that case as well, getting a token is not needed.

## Going further: resolving interceptors with Dependency Injection

Interceptors are a great feature, but at the time of writing, the public API only allows you to add already constructed instances, which can be limiting.
What if our interceptor needs to take dependencies on other services?

Registering the interceptors in the application service provider doesn't work, because EF Core maintains an internal service provider, which is used to resolve interceptors.

I found a way by reverse engineering how EF Core itself is built.
However, as you'll see, the solution is quite involved, and I haven't fully tested it.
As a result, please carefully test it before using this method.

When configuring the `DbContext`, we can register an extension which has access to the internal service provider, hence can register additional services, in this case our interceptor.
However, this internal provider doesn't have as many registered services as a provider used in an ASP.NET Core application.

A good example of that is related to logging.
When trying to inject an instance of `ILogger<T>` in the interceptor, an exception was raised as it couldn't be resolved.
Some more spelunking showed that we need to need to inject an intermediate `ILoggerFactory`; however, it's registered as a scoped service in the internal EF Core provider, where it's usually registered as a singleton in ASP.NET Core apps.
This meant that the interceptor needs to be registered as a scoped service as well, otherwise the resolution of the logger factory failed.

The following implementation is based on the internal [`CoreOptionsExtension`](https://github.com/dotnet/efcore/blob/release/3.1/src/EFCore/Infrastructure/CoreOptionsExtension.cs) used in EF Core.

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
            options.UseSqlServer(Configuration.GetConnectionString("<connection-string-name"));
            ((IDbContextOptionsBuilderInfrastructure)options).AddOrUpdateExtension(new AppOptionsExtension());
        });
    }
}

public class AppOptionsExtension : IDbContextOptionsExtension
{
    private DbContextOptionsExtensionInfo _info;

    public DbContextOptionsExtensionInfo Info => _info ??= new ExtensionInfo(this);

    public void ApplyServices(IServiceCollection services)
    {
        services.AddScoped<IInterceptor, AadAuthenticationDbConnectionInterceptor>();
    }

    public void Validate(IDbContextOptions options)
    {
    }

    private class ExtensionInfo : DbContextOptionsExtensionInfo
    {
        public ExtensionInfo(IDbContextOptionsExtension extension) : base(extension)
        {
        }

        public override bool IsDatabaseProvider => false;
        public override string LogFragment => null;
        public override long GetServiceProviderHashCode() => 0L;
        public override void PopulateDebugInfo(IDictionary<string, string> debugInfo)
        {
        }
    }
}

public class AadAuthenticationDbConnectionInterceptor : DbConnectionInterceptor
{
    private readonly ILogger _logger;

    public AadAuthenticationDbConnectionInterceptor(ILoggerFactory loggerFactory)
    {
        _logger = loggerFactory.CreateLogger<AadAuthenticationDbConnectionInterceptor>();
    }

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
            try
            {
                sqlConnection.AccessToken = await GetAzureSqlAccessToken();
                _logger.LogInformation("Successfully acquired a token to connect to Azure SQL");
            }
            catch (Exception e)
            {
                _logger.LogError(e, "Unable to acquire a token to connect to Azure SQL");
            }
        }
        else
        {
            _logger.LogInformation("No need to get a token");
        }

        return await base.ConnectionOpeningAsync(connection, eventData, result, cancellationToken);
    }

    private static async Task<string> GetAzureSqlAccessToken()
    {
        if (RandomNumberGenerator.GetInt32(10) >= 5)
        {
            throw new Exception("Faking an exception while tying to get a token");
        }

        // See https://docs.microsoft.com/en-us/azure/active-directory/managed-identities-azure-resources/services-support-managed-identities#azure-sql
        var tokenRequestContext = new TokenRequestContext(new[] { "https://database.windows.net//.default" });
        var tokenRequestResult = await new DefaultAzureCredential().GetTokenAsync(tokenRequestContext);

        return tokenRequestResult.Token;
    }
}
```

## Conclusion

In this post, we covered how we can use Azure Active Directory authentication to connect to Azure SQL, focusing on the token-based aspect of it, since we're trying to reduce the amount of sensitive information an application needs to deal with.

We also went over a nice way to integrate AAD authentication with Entity Framework Core, by leveraging interceptors.
The first benefit of using this approach is that we let EF Core manage SQL connections internally.
The second advantage of using interceptors is that they are asynchronous, which allows us not to have to resort to block on asynchronous operations.

Finally, we investigated how we can inject services in our interceptors.
The solution we explored involves quite a bit of ceremony, which makes it pretty heavy.
I opened [an issue on the EF Core repository](https://github.com/dotnet/efcore/issues/21578), we'll see if the team finds a way to make this more friendly.
Please [let me know on Twitter](https://twitter.com/mderriey) if you know of an easier way to achieve this.

I hope you liked this post!
