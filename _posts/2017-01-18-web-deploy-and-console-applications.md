---
layout: post
title: Web Deploy and console applications
description: How to take advantage of Web Deploy with console applications
---

Supporting links:

 - [Web Deploy Command Line Reference](https://technet.microsoft.com/en-us/library/dd568991.aspx)
 - [Web Deploy Command Line Syntax](https://technet.microsoft.com/en-us/library/dd569106.aspx)

I blogged a few months ago about [some tricks I learned about Web Deploy](/2016/11/18/recent-findings-with-web-deploy/). While the integration for web projects is excellent thanks to WPP - Web Publishing Pipeline - we cannot say the same for console applications.

In this post, we will see how we can take advantage of Web Deploy to package and deploy console applications.

### Packaging

When we build a console application, all the necessary files are output to a single folder which contains the executable, the configuration file and the necessary assemblies.

I didn't know how Web Deploy was used by WPP to package a web application, so I read the [documentation](https://technet.microsoft.com/en-us/library/dd569106.aspx). In essence, Web Deploy can synchronise two data sources, each of them using a [particular provider](https://technet.microsoft.com/en-us/library/dd569040.aspx).

In our case, the source is the content of a folder, which is handled by the [`dirPath`](https://technet.microsoft.com/en-us/library/ee207412.aspx) provider. The destination is a WebDeploy package, and for this matter, we can use the [`package`](https://technet.microsoft.com/en-us/library/dd569019.aspx) provider. Here is a command we can execute to achieve this:

```cmd
msdeploy.exe -verb:sync -source:dirPath="C:\source-directory" -dest:package="C:\destination-package.zip"
```

The good news is that we can declare parameters as we do for web applications with the [`declareParamFile`](https://technet.microsoft.com/en-us/library/dd569089.aspx) operation. This allows us to set parameters values at deployment time for application settings or connection strings:

```cmd
msdeploy.exe -verb:sync -source:dirPath="C:\source-directory" -dest:package="C:\destination-package.zip" -declareParamFile:"C:\parameters.xml"
```

This step is very easy to integrate with any CI server you might use. In the end, we get a parameterised package, ready to be deployed.

### Deployment

What is the goal of the deployment of a console application? Most of the time, it will be to have all the necessary files in a specific folder so the program can run. Going from a package to a folder is the exact opposite of what we did to package the application.

It is indeed just a matter of switching the source and destination providers, and specifying values for the parameters we declared during the packaging phase. To do this, we use the [`setParamFile`](https://technet.microsoft.com/en-us/library/dd569089.aspx) operation:

```cmd
msdeploy.exe -verb:sync -source:package="C:\destination-package.zip" -dest:dirPath="C:\destination-folder" -setParamFile:"C:\parameters-values.xml"
```

And voilà, we've successfully packaged up a console application in a single package and deployed it with specific parameters. You can find sample code on my [GitHub repository](https://github.com/mderriey/web-deploy-console-applications) where I use PowerShell scripts to invoke Web Deploy.