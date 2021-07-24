---
layout: post
title: A new and easy way to use AAD authentication with Azure SQL
description: In this post we see how we can use Microsoft.Data.SqlClient for a code-free solution to connect to Azure SQL with AAD authentication.
---

# Introduction

I blogged [in the past](https://mderriey.com/2020/09/12/resolve-ef-core-interceptors-with-dependency-injection/) about connecting to Azure SQL using AAD authentication.
By using Azure managed identity, our application can connect to Azure SQL without the need to secure any kind of credential.

However, so far it was the responsibility of the application to acquire an access token from AAD and attach it to the SQL connection.
On top of that, token caching and renewal was another aspect application developers needed to keep in mind to avoid unnecessary network requests.
Even though .NET libraries helped achieving this, it was custom code that needed to be maintained.

Let's have a look at a new, code-free way of achieving the same result.

## Native support in `Microsoft.Data.SqlClient`

In June 2021, Microsoft released version 3.0 of `Microsoft.Data.SqlClient`, the official SQL Server driver for .NET.

This release supports more scenarios around AAD authentication as it now leverages `Azure.Identity`.
What this means is that instead of having custom code to acquire tokens, cache them, and renew them, these operations are now handled internally by the driver.

Consumers can configure which underlying `Azure.Identity` credential is used through the connection string, via the `Authentication` keyword.

|`Authentication` keyword value|Underlying `Azure.Identity` credential used|Typical scenario|Sources|
|-|-|-|-|
|Active Directory Managed Identity|`ManagedIdentityCredential`|App running on Azure|Managed identity|
|Active Directory Default|`DefaultAzureCredential`|Local development|Environment variables, managed identity, VS Code, Visual Studio, Azure CLI|

Leveraging AAD authentication could not get any simpler!

```csharp
public async Task Main(string[] args)
{
    var connectionString = "Data Source=<my-azure-sql-instance>.database.windows.net; Initial Catalog=<my-database>; Authentication=Active Directory Default";

    for (var i = 0; i < 10; i++)
    {
        await using var connection = new SqlConnection(connectionString);
        var count = await connection.QuerySingleAsync<int>("SELECT COUNT(0) FROM [dbo].[MyTable]");

        Console.WriteLine($"There are {count} items in the table");
    }
}
```

Silly example, I know 😇.
The point is that by running this program, a single token will be acquired during the first query, and the nine others will use the token cached internally.

## Potential drawbacks

I find this solution fantastic, and I've been using it in a couple of applications with no issues.
However, I think it's worth mentioning that it's not perfect, and you might want to analyse whether it's the right approach for you.

The first effect of using this method is that since the driver orchestrates `Azure.Identity` itself, we lose some flexibility.
It's not possible anymore for an application to specify a specific list of credentials via `ChainedTokenCredential`.
I personally don't think this is a big issue, but some applications might have stricter requirements.

The second thing to be aware of is that since v3 is a new major version, it's coming with breaking changes.
One of them is for columns that are mapped to properties of type `byte[]`, if the column value is `NULL`, the driver will return `DBNull.Value` instead of an empty byte array.

This change might impact EF Core as there's been a report of applications breaking after updating to `Microsoft.Data.SqlClient` v3.0, see <https://github.com/dotnet/efcore/issues/25074>.
At the time of writing, the EF Core team plans on fixing this for the 6.0 release, but will potentially issue a patch if it's not too tricky to fix.

## Conclusion

In this post, we saw how we can free our applications of several token-related concerns by leveraging the new supported scenarios around AAD authentication in `Microsoft.Data.SqlClient`.
We also emphasised that a proper analysis should be conducted before jumping on this new version as we lose some flexibility, and some breaking changes might cause issues.

Additional links:

- Using Azure Active Directory authentication with SqlClient: <https://docs.microsoft.com/en-us/sql/connect/ado-net/sql/azure-active-directory-authentication?view=sql-server-ver15>.
- `Microsoft.Data.SqlClient` v3.0 release notes: <https://github.com/dotnet/SqlClient/blob/main/release-notes/3.0/3.0.0.md>.
- Potential EF Core bug when using v3.0 and `byte[]` properties: <https://github.com/dotnet/efcore/issues/25074>.
