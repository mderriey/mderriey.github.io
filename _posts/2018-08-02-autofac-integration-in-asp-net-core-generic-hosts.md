---
layout: post
title: How to integrate Autofac in ASP.NET Core generic hosts
description: How to integrate Autofac in ASP.NET Core generic hosts
---

ASP.NET Core 2.1 brought a new feature that is [generic hosts](https://docs.microsoft.com/en-us/aspnet/core/fundamentals/host/generic-host?view=aspnetcore-2.1). They allow to write apps that rely on ASP.NET Core concepts like logging, configuration and built-in DI but that are not web applications.

I was playing with them yesterday and wanted to see if I could easily integrate the Autofac IoC container with it. After looking at the [ASP.NET Core integration page in the Autofac docs](https://autofaccn.readthedocs.io/en/latest/integration/aspnetcore.html#quick-start-with-configurecontainer), I came up with code that looks like the following:

```csharp
using System.Threading.Tasks;
using Autofac;
using Autofac.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

internal class Program
{
    public static async Task Main(string[] args)
    {
        await new HostBuilder()
            .ConfigureServices(services => services.AddAutofac())
            .ConfigureContainer<ContainerBuilder>(builder =>
            {
                // registering services in the Autofac ContainerBuilder
            })
            .UseConsoleLifetime()
            .Build()
            .RunAsync();
    }
}
```

This all looks pretty straightforward and follows the docs, but at runtime the application threw an exception with the following error message:

```
System.InvalidCastException: 'Unable to cast object of type 'Microsoft.Extensions.DependencyInjection.ServiceCollection' to type 'Autofac.ContainerBuilder'.'
```

That's interesting, given:

 - `services.AddAutofac()` registers an `AutofacServiceProviderFactory` instance as `IServiceProviderFactory` as we can see [here](https://github.com/autofac/Autofac.Extensions.DependencyInjection/blob/c6f14d73afe25c5c0cf1420581921d7c7790426f/src/Autofac.Extensions.DependencyInjection/ServiceCollectionExtensions.cs#L42-L45); and
  - [the code](https://github.com/autofac/Autofac.Extensions.DependencyInjection/blob/c6f14d73afe25c5c0cf1420581921d7c7790426f/src/Autofac.Extensions.DependencyInjection/AutofacServiceProviderFactory.cs#L52-L61) tells us that the `CreateBuilder` method of `AutofacServiceProviderFactory` returns an instance of `ContainerBuilder`

So we're all good, right?! What's wrong?!
Interestingly, I also read [Andrew Lock's post about the differences between web host and generic host](https://andrewlock.net/the-asp-net-core-generic-host-namespace-clashes-and-extension-methods/) yesterday, and thought maybe something was fooling us into thinking we were doing the right thing.

So I cloned the [`aspnet/Hosting`](https://github.com/aspnet/Hosting) repo, checked out the `2.1.1` tag, opened the solution in Visual Studio, and started readong through the [`HostBuilder.cs`](https://github.com/aspnet/Hosting/blob/2.1.1/src/Microsoft.Extensions.Hosting/HostBuilder.cs) file.

And there it was: the `HostBuilder` class uses a [`ServiceProviderAdapter`](https://github.com/aspnet/Hosting/blob/2.1.1/src/Microsoft.Extensions.Hosting/HostBuilder.cs#L23) that wraps the `IServiceProviderFactory`. This means that registering an `IServiceProviderFactory` like `services.AddAutofac()` does conveys no _meaning_ to a `HostBuilder`.

Luckily, while going through the code, I also found the [`UseServiceProviderFactory`](https://github.com/aspnet/Hosting/blob/2.1.1/src/Microsoft.Extensions.Hosting/HostBuilder.cs#L78-L82) method on the `HostBuilder` class. The difference is that this one wraps the provided factory within the adapter.

The code then became:

```csharp
using System.Threading.Tasks;
using Autofac;
using Autofac.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

internal class Program
{
    public static async Task Main(string[] args)
    {
        await new HostBuilder()
            .UseServiceProviderFactory(new AutofacServiceProviderFactory())
            .ConfigureContainer<ContainerBuilder>(builder =>
            {
                // registering services in the Autofac ContainerBuilder
            })
            .UseConsoleLifetime()
            .Build()
            .RunAsync();
    }
}
```

And it worked!

I don't know why the generic host uses an adapter around the service provider factory &mdash; I asked the question on [Twitter](https://twitter.com/mderriey/status/1024825645803569152), time will tell if we get the answer.

The morale here is very close to the one in Andrew's post: don't assume everything you know about web host is true or will work with generic host.

