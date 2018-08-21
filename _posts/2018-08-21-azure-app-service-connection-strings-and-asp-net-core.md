---
layout: post
title: Azure App Service connection strings and ASP.NET Core - How?!
description: A story of wanting to know how things work
---

Here's a quick one.
You know how in ASP.NET Core there's this new configuration model where you can get values from different providers?
If not, I suggest you read the [official documentation](https://docs.microsoft.com/en-us/aspnet/core/fundamentals/configuration/?view=aspnetcore-2.1&tabs=basicconfiguration) on it which is absolutely great!

### A primer

For the purpose of this post, let's imagine an ASP.NET Core MVC application that reads configuration from these sources:

 - the `appsettings.json` file; and
 - the environment variables

 The order matters here, because if several providers export the same value, the last one wins.
 In our case, imagine that the JSON file is the following:

 ```json
 {
   "ConnectionStrings": {
     "SqlConnection": "Data Source=server; Initial Catalog=database; Integrated Security=SSPI"
   }
 }
 ```

 Let's also imagine that we have an environment variable called `CONNECTIONSTRINGS:SQLCONNECTION` with the value `Data Source=different-server; Initial Catalog=different-database; Integrated Security=SSPI`.

 In that case, the value coming from the environment variable _wins_ and will be the one returned from the configuration.

### On to our interesting case

Azure App Service allows you to specify both [application settings](https://docs.microsoft.com/en-us/azure/app-service/web-sites-configure#app-settings) and [connection strings](https://docs.microsoft.com/en-us/azure/app-service/web-sites-configure#connection-strings) so that you don't need to deploy your application again if you want to change some configuration settings.

The documentation states that connection strings will be exposed as environment variables which will be prefixed based on which type of connection string you create

| Type of connection string | Prefix             |
|---------------------------|--------------------|
| SQL Server                | `SQLCONNSTR_`      |
| MySQL                     | `MYSQLCONNSTR_`    |
| Azure SQL                 | `AZURESQLCONNSTR_` |
| Custom                    | `CUSTOMCONNSTR_`   |

My colleague [Dom](https://twitter.com/DominikRan) had an ASP.NET Core web application deployed to an Azure App Service. This application was sourcing a connection string from the `ConnectionStrings:SqlConnection` configuration key.

I was very surprised when he created an Azure SQL connection string named `SqlConnection` in his App Service and his app used it to connect to his Azure SQL database!

If we follow the docs, the environment variable corresponding to this connection string would be named `AZURESQLCONNSTR_SQLCONNECTION`. It was  the case as we double-checked that in the Kudu console where you can see all the environment variables of your App Service.

### So how did it work?!

I know. Much confusion.
My understanding was that only an environment variable named `CONNECTIONSTRINGS:SQLCONNECTION` would override the one that was present in the `appsettings.json` configuration file.

What next?
Lucky for us, all that configuration code is open-source and available on the [`aspnet/Configuration`](https://github.com/aspnet/Configuration) repository on GitHub.
This contains both the abstractions and several providers: JSON, XML and INI files, environment variables, command line arguments, Azure Key Vault, etc...

Next step is digging in the environment variables provider to see if there's anything of interest.
And there is!
Having a look at the [`EnvironmentVariablesConfigurationProvider`](https://github.com/aspnet/Configuration/blob/f529702078e662b6268b3909faa285c6e072d05e/src/Config.EnvironmentVariables/EnvironmentVariablesConfigurationProvider.cs) class, it all falls into place.

The provider checks for all the prefixes present in the table above and replaces them with `ConnectionStrings:` when feeding the data into the configuration model.
This means that an environment variable named `AZURESQLCONNSTR_SQLCONNECTION` is fed into the configuration system with the `ConnectionStrings:SqlConnection` value.
This explains why creating a connection string in the Azure App Service made the application change its connection string.

I'm happy because I learnt something new.

### Bonus

I actually learnt something else.
Double underscores in environment variables will be replaced by the configuration delimiter, `:`, when fed into the configuration model.
That's shown by [the `NormalizeKey` method](https://github.com/aspnet/Configuration/blob/f529702078e662b6268b3909faa285c6e072d05e/src/Config.EnvironmentVariables/EnvironmentVariablesConfigurationProvider.cs#L65-L68).
This means that if we were not using Azure App Service, we could override the connection string with two environment variables: `ConnectionStrings:SqlConnection` and `ConnectionStrings__SqlConnection`.