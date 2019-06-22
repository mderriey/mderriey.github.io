---
layout: post
title: ASP.NET Core and JSON Web Tokens - where are my claims?
description: This post covers the default behaviour of ASP.NET Core when dealing when JWTs, where it comes from, and how to opt out of it.
---

# Introduction

When extracting an identity from a JSON Web Token (JWT), ASP.NET Core &mdash; and .NET in general &mdash; maps some claims. In other words, the claims in the instance of `ClaimsIdentity` do not match perfectly the ones found in the JWT payload.

In this post we'll go through an example of that behaviour, discover where that comes from, and how to opt out.

### An example

If you use OpenID Connect- or OAuth2-based authentication in your application, there's a high chance this is happening, potentially without you knowing, because it's the default behaviour.

Let's imagine we have an ASP.NET Core application using OpenID Connect to authenticate its users against an OIDC identity provider.

```csharp
public void ConfigureServices(IServiceCollection services)
{
    services
        .AddAuthentication(options =>
        {
            options.DefaultScheme = "Cookies";
            options.DefaultChallengeScheme = "OpenIDConnect";
        })
        .AddOpenIdConnect("OpenIDConnect", options =>
        {
            options.Authority = "<the-url-to-the-identity-provider>";
            options.ClientId = "<the-client-id>";
        })
        .AddCookie("Cookies");
}
```

Here's what the payload part of the issues JWT could look like:

```json
{
  "aud": "<audience>",
  "iss": "<issuer-of-the-jwt>",
  "iat": 1561237872,
  "nbf": 1561237872,
  "exp": 1561241772,
  "email": "<email-address>",
  "name": "Someone Cool",
  "nonce": "636968349704644732.MjU2MzhiNzMtNDYwNi00NjZjLTkxZDItYjY3YTJkZDMzMzk0ODMyYzQxYzItNmRmNi00NmFiLThiMzItN2QxYjZkNzg5YjE4",
  "oid": "84a52e7b-d379-410d-bc6a-636c3d11d7b2",
  "preferred_username": "Someone Cool",
  "sub": "<some-opaque-identifier>",
  "tid": "<tenant-id>",
  "uti": "bGsQjxNN_UWE-Z2h-wEAAA",
  "ver": "2.0"
}
```

Now, here's what the JSON representation of the claims in the extracted `ClaimsIdentity` would be:

```json
{
  "aud": "<audience>",
  "iss": "<issuer-of-the-jwt>",
  "iat": 1561238329,
  "nbf": 1561238329,
  "exp": 1561242229,
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress": "<email-address>",
  "name": "Someone Cool",
  "nonce": "636968354285381824.ZmE2M2Y2NWItZjc5NS00NTc3LWE5ZWItMGQxMjI2MjYwNjgyODI3Yjg1NTItYWMzYS00MDE3LThkMjctZjBkZDRkZmExOWI1",
  "http://schemas.microsoft.com/identity/claims/objectidentifier": "84a52e7b-d379-410d-bc6a-636c3d11d7b2",
  "preferred_username": "Someone Cool",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier": "<some-opaque-identifier>",
  "http://schemas.microsoft.com/identity/claims/tenantid": "<tenant-id>",
  "uti": "rzybpqYLHEi4Wyk-yv0AAA",
  "ver": "2.0"
}
```

While some claims are identical, some of them got their name changed &mdash; let's list them:

| Claim name in JWT | Claim name in `ClaimsIdentity`                                         |
|-------------------|------------------------------------------------------------------------|
| `email`           | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress`   |
| `oid`             | `http://schemas.microsoft.com/identity/claims/objectidentifier`        |
| `sub`             | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier` |
| `tid`             | `http://schemas.microsoft.com/identity/claims/tenantid`                |

Let's have a look at where that behaviour comes from.

### How does that happen?

The answer to that question lies in the library that is used to handle JSON Web Tokens &mdash; the validation and the extraction of an identity. This is the [`System.IdentityModel.Tokens.Jwt`](https://www.nuget.org/packages/System.IdentityModel.Tokens.Jwt/) NuGet package, which source code is also on GitHub at the [`AzureAD/azure-activedirectory-identitymodel-extensions-for-dotnet`](https://github.com/AzureAD/azure-activedirectory-identitymodel-extensions-for-dotnet/tree/dev/src/System.IdentityModel.Tokens.Jwt) repository.

The main class is the `JwtSecurityTokenHandler`, but the ones were after is [`ClaimTypeMapping`](https://github.com/AzureAD/azure-activedirectory-identitymodel-extensions-for-dotnet/blob/dev/src/System.IdentityModel.Tokens.Jwt/ClaimTypeMapping.cs). Because it's quite a big portion of code, here's the link to the relevant part: <https://github.com/AzureAD/azure-activedirectory-identitymodel-extensions-for-dotnet/blob/a301921ff5904b2fe084c38e41c969f4b2166bcb/src/System.IdentityModel.Tokens.Jwt/ClaimTypeMapping.cs#L45-L125>.

There we have it, a whopping 72 claims being renamed as they're processed!

### How do I opt out of this?

This behaviour could be confusing; imagine you consult the documentation of your identity provider to understand which claims you can expect back in a JWT that it issues, only to find that some of them are missing when you develop your .NET application!

Luckily, there are multiple ways to disable that behaviour.

##### 1. The global, application-level way

The `JwtSecurityTokenHandler` class takes a static copy of the mapping dcutionary declared by `ClaimTypeMapping`, as you can see [here on GitHub](https://github.com/AzureAD/azure-activedirectory-identitymodel-extensions-for-dotnet/blob/a301921ff5904b2fe084c38e41c969f4b2166bcb/src/System.IdentityModel.Tokens.Jwt/JwtSecurityTokenHandler.cs#L57-L60). This static copy is used by default by all instances of `JwtSecurityTokenHandler`. The trick is to clear this dictionary when the application starts.

In an ASP.NET Core app, that could be done in `Program.Main`, for example. My preference would be to put it closer to related code, maybe in `Startup.ConfigureServices`.

```csharp
public void ConfigureServices(IServiceCollection services)
{
    // This is the line we just added
    JwtSecurityTokenHandler.DefaultInboundClaimTypeMap.Clear();

    services
        .AddAuthentication(options =>
        {
            options.DefaultScheme = "Cookies";
            options.DefaultChallengeScheme = "OpenIDConnect";
        })
        .AddOpenIdConnect("OpenIDConnect", options =>
        {
            options.Authority = "<the-url-to-the-identity-provider>";
            options.ClientId = "<the-client-id>";
        })
        .AddCookie("Cookies");
}
```

##### 2. The per-handler way

While opting out at the application level is unlikely to be an issue if you develop a new application, t could have unintended consequences if we were to use it in an existing codebase. The good news is that `JwtSecurityTokenHandler` exposes instance-level properties which allow us to achieve the same result.

The first option is to clear the instance-level claims mappings dictionary of the handler:

```csharp
public void ConfigureServices(IServiceCollection services)
{
    services
        .AddAuthentication(options =>
        {
            options.DefaultScheme = "Cookies";
            options.DefaultChallengeScheme = "OpenIDConnect";
        })
        .AddOpenIdConnect("OpenIDConnect", options =>
        {
            options.Authority = "<the-url-to-the-identity-provider>";
            options.ClientId = "<the-client-id>";

            // First option
            // Clear the instance-level dictionary containing the claims mappings
            var jwtHandler = new JwtSecurityTokenHandler();
            jwtHandler.InboundClaimTypeMap.Clear();

            options.SecurityTokenValidator = jwtHandler;
        })
        .AddCookie("Cookies");
}
```

The second one is to instruct the handler not to perform claims mappings, regardless of whether the dictionary contains mapping or not:

```csharp
public void ConfigureServices(IServiceCollection services)
{
    services
        .AddAuthentication(options =>
        {
            options.DefaultScheme = "Cookies";
            options.DefaultChallengeScheme = "OpenIDConnect";
        })
        .AddOpenIdConnect("OpenIDConnect", options =>
        {
            options.Authority = "<the-url-to-the-identity-provider>";
            options.ClientId = "<the-client-id>";

            // Second options
            // Instruct the handler not to perform claims mapping
            var jwtHandler = new JwtSecurityTokenHandler
            {
                MapInboundClaims = false
            };

            options.SecurityTokenValidator = jwtHandler;
        })
        .AddCookie("Cookies");
}
```

### Conclusion

In this post we went through the default behaviour in which JWT claims are being mapped to different names in .NET applications. By going through the source code of the library that handles JSON Web Tokens, we also pinned down how the library implements the mapping, as well as several ways to disable it.

What library did you wish you knew the internals of better? There's a high chance it's open source on GitHub these days, and if it isn't, you can always use a .NET decompiler to read the code.
