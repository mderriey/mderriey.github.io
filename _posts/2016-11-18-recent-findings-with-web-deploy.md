---
layout: post
title: Recent findings about Web Deploy
description: A collection of findings about Web Deploy
---

Supporting links:

 - [Prevent connection strings tokenization](https://blogs.msdn.microsoft.com/webdev/2010/11/10/asp-net-web-application-publishpackage-tokenizing-parameters/)
 - [Configuring parameters for web package deployment](https://www.asp.net/web-forms/overview/deployment/web-deployment-in-the-enterprise/configuring-parameters-for-web-package-deployment)
 - [Reference for the web application package](https://www.iis.net/learn/develop/windows-web-application-gallery/reference-for-the-web-application-package)

The client I'm working for right now doesn't do automated deployments. This means that a person manually deploys all the applications. However, while building the [API I talked about in a previous post](/2016/11/18/correlation-id-with-asp-net-web-api/), I'm trying to make the dpeloyment process as easy as it can be. [Web Deploy](https://www.iis.net/downloads/microsoft/web-deploy) is a proven way of deploying ASP.NET-based applications.

In this post I'll walk you through the process I took so that the deployment is as painless as possible.

### Setup

Visual Studio has built-in tooling for creating Web Deploy packages. If you "right-click &rarr; Publish" an ASP.NET project, you can define a publish profile which you can later invoke with MSBuild. In my case, I selected a Web Deploy Package as the output. This gives us a starting point.

### Connection strings

As I don't know the credentials of the service accounts that are used on the different environments, I want the person deploying the package to type them when deploying the package. By default, Visual Studio - or, more precisely, the Web Publishing Pipeline which is invoked by a `.targets` file referenced in the `.csproj` - tokenizes the connection strings it finds in the `web.config`. While this is very nice, the generated names of the parameters are not so nice. The convention is to name them `[name of the connection string]-Web.config Connection String`. I don't find this really user-friendly.

Luckily for us, there's a way for us to disable that. I think everyone has googled this at least once, so it probably won't be a surprise. You can disable that tokenization through an MSBuild property that WPP checks during the process. Just edit your `.csproj` and add the following property:

```xml
<AutoParameterizationWebConfigConnectionStrings>false</AutoParameterizationWebConfigConnectionStrings>
```

Happy days? Well, only partially, at least in my case. This worked for the SQL Server connection string, but we also use IBM DB2, and that one was still getting tokenized. I think this has to do with the Visual Studio tooling not handling other ADO.NET providers well, apart from `System.Data.SqlClient`. I tracked this down to the `.pubxml` file, where there was a subtle difference between the two connection strings definitions:

```xml
<ItemGroup>
  <MSDeployParameterValue Include="$(DeployParameterPrefix)Db2-Web.config Connection String" />
  <MSDeployParameterValue Include="$(DeployParameterPrefix)SqlServer-Web.config Connection String">
    <UpdateDestWebConfig>False</UpdateDestWebConfig>
  </MSDeployParameterValue>
</ItemGroup>
```

Somehow this kept the DB2 connection string being tokenized. Adding the `UpdateDestWebConfig` property like for the SQL Server one took care of it.

### OK, but now connection strings can't be entered when you deploy the package

Correct, we're only halfway there.

Another thing I found was that you can hook in the Web Publishing Pipeline by creating a `parameters.xml` file in your web project, as shown on [this page](https://technet.microsoft.com/en-us/library/dd569084(v=ws.10).aspx). In our case, it's a matter of adding 2 parameters for our connection strings:

```xml
<parameters>
  <parameter name="SQL Server connection string"
             description="The connection string to the SQL Server database"
             tags="SqlConnectionString">
    <parameterEntry kind="XmlFile"
                    scope="\\Web\.config$"
                    match="/configuration/connectionStrings/add[@name='SqlServer']/@connectionString" />
  </parameter>

  <parameter name="DB2 connection string"
             description="The connection string to the DB2 database"
             tags="SqlConnectionString">
    <parameterEntry kind="XmlFile"
                    scope="\\Web\.config$"
                    match="/configuration/connectionStrings/add[@name='Db2']/@connectionString" />
  </parameter>
</parameters>
```

Our parameters now have pretty names! I used the same approach for other parameters, like the log file path.

### A small twist

There's a special value in the `web.config` that contains the name of the environment the application is deployed on. This allows, for example, to disable the swagger endpoint exposing metadata on the API if it's deployed in production. In my C# code I have an enum to represent the possible environments:

```csharp
public enum Env
{
    Development,
    Test,
    Production
}
```

I use [`Enum.TryParse`](https://msdn.microsoft.com/en-us/library/dd783499(v=vs.110).aspx) to avoid exceptions and fall back to `Development` if there's no match, but to minimise the risk of errors we can show a nice dropdown list in IIS manager when the package is getting deployed:

```xml
<parameter name="Environment"
           description="The environment on which the application is about to be deployed">
  <parameterValidation kind="Enumeration"
                       validationString="Test,Production /">
  <parameterEntry kind="XmlFile"
                  scope="\\Web\.config$"
                  match="/configuration/appSettings/add[@key='Environment']/@value" />
</parameter>
```

This will show a dropdown list containing only the values I selected. No errors possible if you deploy the package with the UI. This one was tricky because the [official documentation](https://www.iis.net/learn/develop/windows-web-application-gallery/reference-for-the-web-application-package) uses the `type` attribute on the `parameterValidation`, and it doesn't work. Hopefully [this answer on StackOverflow](http://stackoverflow.com/a/29376556/562839) worked.

### A quick word on web.config transformations

If you made it this far, then first: thank you! If you made it this far thinking "duh, just put all those connection strings and parameters in a `Web.[Configuration].config` and you're good to go", then I hope you'll read the next few lines.

I think web.config transformations are amazing. Really. They make it really easy to make changes here and there when you publish a package. But in my opinion they shouldn't be used to replace information like connection string and application settings on-the-fly. Here's why.

#### You don't have a single package anymore

Ideally, you want to embrace the `Build once, deploy many` mantra which means that a single package can be deployed to all the environments - up to Production. Having web.config transformations for connection strings means you can't deploy your test package to production because the connection string is hardcoded in the `web.config`. Bummer. You have to build another one for production, but how can you be sure they contain exactly the same version of your code?

This is why, for example, Octopus Deploy took a different approach. All the configuration-specific transformation files are included in the deployment package, and only when actually deploying it are the transformations run. Winning!

#### It's a maintainability nightmare

In order to have transformations being applied, you need to have a corresponding MSBuild - hence Visual Studio - configuration. It's a bit of a pain to maintain because every new project you add will only have the default `Debug` and `Release` configurations.

#### Don't put sensitive information in source control

This is probably the most important one. You don't want to have your SQL production credentials visible to everyone. Ever.

#### So what are they good for, then?

I think they're really good for things you want to apply to all environments. The default `Web.Release.config` only removes the `debug` attribute on the `compilation` element. I think this is a great example, as leaving it can have performance impact on your application. I can't find others off the top of my head, but I'm sure there are.
