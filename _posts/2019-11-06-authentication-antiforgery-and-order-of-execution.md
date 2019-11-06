---
layout: post
title: Authentication, antiforgery, and order of execution of filters
description: Tag along the journey I went through to diagnose why things didn't work as expected.
---

# Introduction

I recently had to build a super simple application that had two main parts:

1. the home page was accessible to anonymous users and presented them with a basic form;
1. an "admin" section that required users to be authenticated, and where they could approve or reject submissions done via the home page.

Super simple, but I faced an issue related to antiforgery that I couldn't understand at the time.
I went with a workaround but thought I'd dig a bit deeper when I have time.
Let's have a look at it together!

## How it was set up

### Authentication

We'll first go through how authentication was wired.
Because only a subset of pages needed the user to be authenticated, I thought I'd configure the app so that authentication runs only for requests that need it.
What this means in practice is not setting the `DefaultAuthenticateScheme` on `AuthenticationOptions`, and be explicit about the authentication scheme in the authorisation policy. Doing it this way has the advantage of doing authentication "just in time", only for requests that need it.

```csharp
// Startup.cs
public void ConfigureServices(IServiceCollection services)
{
    services
        .AddAuthentication()
        .AddCookie("Cookie");

    services
        .AddAuthorization(options =>
        {
            options.AddPolicy("LoggedInWithCookie", builder => builder
                .AddAuthenticationSchemes("Cookie")
                .RequireAuthenticatedUser());
        });
}

// HomeController.cs
// No authentication required here
public class HomeController : Controller
{
    [HttpGet("")]
    public IActionResult Index() => View();
}

// AdminController.cs
// All requests must be authenticated
[Route("admin")]
[Authorize(Policy = "LoggedInWithCookie")]
public class AdminController : Controller
{
    [HttpGet("")]
    public IActionResult Index() => View();
}
```

### Antiforgery

The other part that we're interested in is antiforgery.

If you don't know what that is, it's the mechanism that protects ASP.NET Core from cross-site request forgery (XSRF).
You can read more about it on the [great official docs](https://docs.microsoft.com/en-us/aspnet/core/security/anti-request-forgery?view=aspnetcore-3.0).

My recommendation, instead of opting in antiforgery on a per-endpoint basis, is to take advantage of the `AutoValidateAntiforgeryTokenAttribute` filter, which "lights up" the check for all requests except GET, HEAD, TRACE and OPTIONS ones.
Should you want to not enable antiforgery on a specific endpoint, you can apply the `[IgnoreAntiforgeryToken]` attribute as an opt-out mechanism &mdash; it's the authentication equivalent of `[AllowAnonymous]`.

I chose to apply antiforgery globally like so:

```csharp
// Startup.cs
public void ConfigureServices(IServiceCollection services)
{
    [...]

    services.AddMvc(options =>
    {
        options.Filters.Add<AutoValidateAntiforgeryTokenAttribute>();
    });
}
```

## The issue

The antiforgery mechanism worked well for the home page, in that trying to send POST requests from Postman didn't work and returned an expected 400 HTTP response.

However, the approval/rejection requests in the admin section didn't work and fetched the following error message:

```
Microsoft.AspNetCore.Antiforgery.AntiforgeryValidationException: The provided antiforgery token was meant for a different claims-based user than the current user.
```

## The diagnosis

After doing some tests, I came to the conclusion that it was failing because when the antiforgery check was made, authentication had not run yet, so the request was treated as if it was anonymous, and that didn't match the hidden field POSTed in the HTML form, nor the antiforgery cookie value.
This was surprising to me as the [documentation for the `AutoValidateAntiforgeryTokenAttribute` class](https://github.com/aspnet/AspNetCore/blob/81379147e69864bf841c2953b50bb0849ceb830e/src/Mvc/Mvc.ViewFeatures/src/AutoValidateAntiforgeryTokenAttribute.cs#L24-L40) mentions that the `Order` property is explicitly set to `1000` so that it runs after authentication.

To validate my suspicions, I changed the minimum logging level on the app to `Debug`, ran the request again, and this came up (slightly updated to avoid super long lines):

```
Execution plan of authorization filters (in the following order):
 - Microsoft.AspNetCore.Mvc.ViewFeatures.Internal.AutoValidateAntiforgeryTokenAuthorizationFilter
 - Microsoft.AspNetCore.Mvc.Authorization.AuthorizeFilter
```

This confirmed what my hunch was.
Now we need to figure out why this is the case.

## The solution

It was 100% random that I tried a different way of adding the antiforgery filter to the MVC global filters collection.
But it worked 🤔.

```csharp
// Startup.cs
public void ConfigureServices(IServiceCollection services)
{
    [...]

    services.AddMvc(options =>
    {
        // What it was before
        // options.Filters.Add<AutoValidateAntiforgeryTokenAttribute>();

        // What I tried for no logical reason
        options.Filter.Add(new AutoValidateAntiforgeryTokenAttribute());
    });
}
```

Why did it work?
The fact that ASP.NET Core is open-source makes these types of researchs really easy.
So I compared both overloads of the `Add` method of the `FilterCollection` class.

It turns out that the [generic overload `Add<T>()`](https://github.com/aspnet/AspNetCore/blob/master/src/Mvc/Mvc.Core/src/Filters/FilterCollection.cs#L22-L25) calls another generic overload [with an extra parameter `order` with a value of `0`](https://github.com/aspnet/AspNetCore/blob/81379147e69864bf841c2953b50bb0849ceb830e/src/Mvc/Mvc.Core/src/Filters/FilterCollection.cs#L37-L45) which, [ultimately](https://github.com/aspnet/AspNetCore/blob/81379147e69864bf841c2953b50bb0849ceb830e/src/Mvc/Mvc.Core/src/Filters/FilterCollection.cs#L74-L92), creates an instance of `TypeFilterAttribute` which "wraps" the original filter type, ignoring its order.

Running the app again after making those changes confirmed that using this overload was respecting the `Order` set on `AutoValidateAntiforgeryTokenAttribute`, as I could see the following in the logs (again slightly modified):

```
Execution plan of authorization filters (in the following order):
 - Microsoft.AspNetCore.Mvc.Authorization.AuthorizeFilter
 - Microsoft.AspNetCore.Mvc.ViewFeatures.Internal.AutoValidateAntiforgeryTokenAuthorizationFilter
```

## Conclusion

Working with an open-source framework makes it easier to figure out why it's sometimes not behaving as you expect it to.
In the future, I'll refrain from using the generic overload, instead I'll instantiate the filter myself to avoid surprises like that one.

I hope you liked that post 👍
