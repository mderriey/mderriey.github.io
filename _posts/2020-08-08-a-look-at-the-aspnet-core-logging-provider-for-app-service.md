---
layout: post
title: A look at the ASP.NET Core logging provider for Azure App Service
description: Embark on a somewhat detailed explanation of how the ASP.NET Core logging provider for Azure App Service works, and how to customise its default behaviour
---

# Introduction

Last week, my colleague Stafford Williams was investigating an issue happening on a web application running on Azure App Service.
Application Insights was taking longer than he was happy with to surface the log entries in the Azure portal, so he started using the Log stream feature of App Service.
While log entries were appearing almost instantly there, by default they're not filtered, so in addition to application logs, you also get framework-level logs, coming from MVC for example.

In this post we'll talk about the ASP.NET Core logging provider for Azure App Service, more specifically:

1. What it does;
1. How to enable it;
1. How it works; and finally
1. How to change its default behaviour.

## What it does

The logging provider for Azure App Service integrates with the logging configuration and the Log stream feature of App Service.
In a nutshell, it allows the log entries created by an ASP.NET Core application to be surfaced in Log stream.

![Screenshot of the Log stream blade in App Service surfacing application log entries](/public/images/posts/2020-08-08-logging-provider-for-app-service/application-logs-in-log-stream.png)
<small><i>Application log entries surfaced in the Log stream blade of an App Service instance</i></small>

Depending on the configuration applied in the App Service logs blade, the provider can write to the App Service file system and/or to a Storage Account, all while respecting the logging level configured for each of them!

![Screenshot of the App Service logs blade showing file system and blob storage logging settings](/public/images/posts/2020-08-08-logging-provider-for-app-service/app-service-logs-blade-settings.png)
<small><i>App Service logs blade showing file system and blob storage logging configuration</i></small>

Because the Log stream integration is linked to the file system logging configuration, we'll focus on this one for the rest of the blog post.

Next, let's see how we can enable this capability in our ASP.NET Core application.

## How to enable it

The first way to enable this capability is my personal favourite because it's explicit; however, it requires code changes.
We need to install the [Microsoft.Extensions.Logging.AzureAppServices NuGet package](https://www.nuget.org/packages/Microsoft.Extensions.Logging.AzureAppServices) and add the appropriate provider to the logging system.
It really is that simple:

```diff
// Program.cs
+using Microsoft.Extensions.Logging;

public static IHostBuilder CreateHostBuilder(string[] args) =>
    Host.CreateDefaultBuilder(args)
+       .ConfigureLogging(builder => builder.AddAzureWebAppDiagnostics())
        .ConfigureWebHostDefaults(webBuilder =>
        {
            webBuilder.UseStartup<Startup>();
        });
```

The other option, if we're in a situation where a code change is not possible for example, is to install the ASP.NET Core Logging Integration App Service extension, which we can do by navigating to the Extensions blade of our App Service.
I also found that the Azure portal offers to install this extension when I went to the App Service logs blade.
My guess is that the Stack property in Configuration > General settings must be set to .NET Core for that option to appear.

![Screenshot of the banner offering to install the ASP.NET Core Logging Extension](/public/images/posts/2020-08-08-logging-provider-for-app-service/install-app-service-extension-banner.png)
<small><i>The banner we can click to install the ASP.NET Core Logging Integration extension</i></small>

Let's now focus on the way this provider works.

## How it works

I learned lots of things while looking up the implementation of that provider, which as always is open-source [on GitHub](https://github.com/dotnet/extensions/tree/release/3.1/src/Logging/Logging.AzureAppServices/src). That link points to the `release/3.1` branch specifically, because there's been a lot of changes in preparation for .NET 5, the most notable being a lot of code moving from the `dotnet/extensions` repo to the `dotnet/runtime` one.

The first observation is that this provider is only enabled [when the app runs on App Service](https://github.com/dotnet/extensions/blob/3dc5e9a24865ab84fce6fc078fce4bd7cfcab5c7/src/Logging/Logging.AzureAppServices/src/AzureAppServicesLoggerFactoryExtensions.cs#L33-L36), which is detected through [a number of well-known environment variables](https://github.com/dotnet/extensions/blob/3dc5e9a24865ab84fce6fc078fce4bd7cfcab5c7/src/Logging/Logging.AzureAppServices/src/WebAppContext.cs#L21-L31) that are present on App Service.
We'll see later how we can take advantage of this to enable it when running the app locally.

The next interesting bit is discovering that the App Service file logger writes log entries to files in the `%HOME%\LogFiles\Application` directory, as seen [in the code](https://github.com/dotnet/extensions/blob/3dc5e9a24865ab84fce6fc078fce4bd7cfcab5c7/src/Logging/Logging.AzureAppServices/src/FileLoggerConfigureOptions.cs#L23).
This explains why those entries show up in the Log stream feature of App Service, as the official documentation points out that "information written to files ending in .txt, .log, or .htm that are stored in the /LogFiles directory (d:/home/logfiles) is streamed by App Service" ([source](https://docs.microsoft.com/en-us/azure/app-service/troubleshoot-diagnostic-logs#stream-logs)).

Another finding is that the settings configured in the App Service logs blade are persisted in a JSON file on the App Service file system, more specifically in the `%HOME%\site\diagnostics\settings.json` file for a Windows App Service.
This file is loaded [in a separate configuration object](https://github.com/dotnet/extensions/blob/3dc5e9a24865ab84fce6fc078fce4bd7cfcab5c7/src/Logging/Logging.AzureAppServices/src/SiteConfigurationProvider.cs).
It's worth noting that reload is supported, indicating that logging settings can be updated and picked up by the app without requiring a restart, which is definitely a good thing.

Here's what the structure of this file looks like:

```jsonc
{
    // File system settings
    "AzureDriveEnabled": true,
    "AzureDriveTraceLevel": "Information",

    // Blob storage settings
    "AzureBlobEnabled": false,
    "AzureBlobTraceLevel": "Error",

    // I suppose those are Table storage settings, but
    // neither the App Service logs blade nor the App Service logging provider
    // seem to set or use them
    "AzureTableEnabled": false,
    "AzureTableTraceLevel": "Error"
}
```

The `AzureDriveEnabled` property drives whether log entries are written to the file system, while the `AzureDriveTraceLevel` one controls the minimum level for the entries to be processed by the provider.
Let's dig deeper on how log entries are filtered based on their level.

The logging stack in ASP.NET Core has built-in support for filters, each of them optionally defining:

- Which logging provider it applies to;
- Which category it matches; and finally
- The minimum level for log entries to satisfy the filter.

The most common way to define filters is through the `Logging` section of the `appsettings.json` file, as documented and explained in the [official documentation on docs.microsoft.com](https://docs.microsoft.com/en-us/aspnet/core/fundamentals/logging/?view=aspnetcore-3.1#configure-logging).

However, filters can also be defined in code, which is the method used by the App Service logger provider.
After loading the logging configuration from the JSON file, a new filter is added to the global configuration with the following settings:

- It only applies to the `FileLoggerProvider`, which is the one responsible to writing log entries to the file system;
- No category is specified, meaning all log entries will be matched; but
- A minimum level is configured, based on the value of the `AzureDriveTraceLevel` property.

See below an extract of the code, which may help in putting the pieces together:

```csharp
public static class AzureAppServicesLoggerFactoryExtensions
{
    internal static ILoggingBuilder AddAzureWebAppDiagnostics(this ILoggingBuilder builder, IWebAppContext context)
    {
        [...]
        // This reads the `%HOME%\site\diagnostics\settings.json` JSON file mentioned earlier
        var config = SiteConfigurationProvider.GetAzureLoggingConfiguration(context);
        [...]
        services.AddSingleton<IConfigureOptions<LoggerFilterOptions>>(CreateFileFilterConfigureOptions(config));
        [...]
    }

    private static ConfigurationBasedLevelSwitcher CreateFileFilterConfigureOptions(IConfiguration config)
    {
        return new ConfigurationBasedLevelSwitcher(
            configuration: config,
            provider: typeof(FileLoggerProvider),
            levelKey: "AzureDriveTraceLevel");
    }
}

internal class ConfigurationBasedLevelSwitcher : IConfigureOptions<LoggerFilterOptions>
{
    private readonly IConfiguration _configuration;
    private readonly Type _provider;
    private readonly string _levelKey;

    public ConfigurationBasedLevelSwitcher(IConfiguration configuration, Type provider, string levelKey)
    {
        _configuration = configuration;
        _provider = provider;
        _levelKey = levelKey;
    }

    public void Configure(LoggerFilterOptions options)
    {
        options.Rules.Add(new LoggerFilterRule(_provider.FullName, null, GetLogLevel(), null));
    }

    private LogLevel GetLogLevel()
    {
        // Implementation omitted for brevity
        // Mapping between the log level defined in App Service JSON file (_levelKey) to a LogLevel value
    }
}
```


Mention that logging providers define an alias that you can use instead of the fully-qualified name.
See `ConsoleLoggerProvider`.

File logging provider goes to `LogFiles\Application`, which is watched by Log stream.
See `FileLoggerConfigureOptions` and <https://docs.microsoft.com/en-us/azure/app-service/troubleshoot-diagnostic-logs#stream-logs>.

Connects the config reload token to the logging system to:

- respect defined log level
- respect which providers are enabled, if any

Maybe go into IOptionsMonitor<T> and how OptionsFactory<T> builds an instance.
See docs at <https://docs.microsoft.com/en-us/aspnet/core/fundamentals/configuration/options?view=aspnetcore-3.1#options-interfaces>
Try to convey that all IConfigureOptions<T> are re-executed when a change is detected through.

## How to customise it

Add another rule.