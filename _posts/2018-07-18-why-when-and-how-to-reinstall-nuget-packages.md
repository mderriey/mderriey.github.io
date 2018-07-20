---
layout: post
title: Why, when and how to reinstall NuGet packages after upgrading a project
description: Why, when and how to reinstall NuGet packages after upgrading a project
---

I was working a codebase this week and noticed a few build warnings that looked like this:

```
Some NuGet packages were installed using a target framework different from the current target framework and may need to be reinstalled.
Visit http://docs.nuget.org/docs/workflows/reinstalling-packages for more information.
Packages affected: <name-of-nuget-package>
```

The docs page is really helpful in understanding in which situations this can happen, but we'll focus on the one situation mentioned in the warning, that is upgrading a project to target a different framework.

## How it looks like before upgrading the project

Let's imagine we have an exiting project targeting .NET 4.5.2 and the Serilog NuGet package is installed.
If we're using `packages.config` and the _old_ .NET project system, our `.csproj` file will contain something that looks like the following:

```xml
<Reference Include="Serilog, Version=2.0.0.0, Culture=neutral, PublicKeyToken=24c2f752a8e58a10, processorArchitecture=MSIL">
  <HintPath>..\packages\Serilog.2.7.1\lib\net45\Serilog.dll</HintPath>
</Reference>
```

The above snippet shows that the assembly that is being used by the project is the one living in the `net45` folder of the NuGet package, which makes sense since we're targeting .NET 4.5.2.

## Upgrading the project

We then decide to upgrade the project to target .NET 4.7.1 through Visual Studio.

Immediately after doing this, we get a build error with the message shown at the beginning of this post.
On subsequent builds, though, the error goes away and we get a warning, which is consistent with what's documented in [item #4 of the docs page](https://docs.microsoft.com/en-au/nuget/consume-packages/reinstalling-and-updating-packages#when-to-reinstall-a-package).

## But why?!

Why do we get those warnings?

NuGet analysed all the installed packages and found out that there are more appropriate assemblies for the new target framework than the ones we're referencing. This is because a NuGet package can contain different assemblies for different target frameworks.

Let's inspect the content of the `lib` directory of the Serilog package:

```
└─lib
  ├─net45
  │   Serilog.dll
  │   Serilog.pdb
  │   Serilog.xml
  │
  ├─net46
  │   Serilog.dll
  │   Serilog.pdb
  │   Serilog.xml
  │
  ├─netstandard1.0
  │   Serilog.dll
  │   Serilog.pdb
  │   Serilog.xml
  │
  └─netstandard1.3
      Serilog.dll
      Serilog.pdb
      Serilog.xml
```

We can see different assemblies for 4 different target frameworks.

My guess is that those warnings are driven by the `requireReinstallation` attribute that is added for those packages in the `packages.config` file:

```xml
<packages>
  <package id="Serilog" version="2.7.1" targetFramework="net452" requireReinstallation="true" />
</packages>
```

## How to fix this?

The way I find easiest to do this is by using the Package Manager Console in Visual Studio by running this command:

`Update-Package <name-of-nuget-package> -Reinstall -ProjectName <name-of-project>`

The most important parameter here is `-Reinstall` as it instructs NuGet to remove the specified NuGet package and reinstall the same version.
This gives NuGet a chance to determine which assembly is most appropriate for the current framework targeted by the project.

Running this command in our sample project would change the `.csproj`:

```xml
<Reference Include="Serilog, Version=2.0.0.0, Culture=neutral, PublicKeyToken=24c2f752a8e58a10, processorArchitecture=MSIL">
  <HintPath>..\packages\Serilog.2.7.1\lib\net46\Serilog.dll</HintPath>
</Reference>
```

And also the `packages.config` file:

```xml
<packages>
  <package id="Serilog" version="2.7.1" targetFramework="net471" />
</packages>
```

The project now references the .NET 4.6 assembly of the package, and the build warning is gone.
I don't know how NuGet internally determines which set of assemblies is best suited for a target framework, though. There might be a matrix somewhere that shows this.

We can run the command for every package that is flagged by NuGet to make sure we reference the correct assemblies. Alternatively, if too many packages are

## Conclusion

We saw that it's easy to get rid of the warnings that can occur when a project is upgraded to target a different framework.

Do you see those warnings when you build a solution? Does a solution-wide search for `requireReinstallation` fetch some results?
You're only a few commands away to being in a cleaner state! Fire away!