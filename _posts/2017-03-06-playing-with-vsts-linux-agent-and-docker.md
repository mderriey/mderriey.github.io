---
layout: post
title: Playing with the VSTS Linux agent and Docker
description: How to run Docker containers as part of a VSTS CI build
---

Microsoft recently added [Linux agents to the VSTS hosted pool](https://azure.microsoft.com/en-us/blog/visual-studio-team-services-january-2017-digest/) in preview. These agents are Docker containers and have the specifity of reusing the host Docker instance from which they were created.

We'll see in this post how we can take advantage of such capability.

## Use case

At [Readify](http://readify.net/), we've been working on an internal application that uses [OrientDB](http://orientdb.com/orientdb/), a graph database engine. People working on this project agreed to use the [OrientDB Docker container](https://hub.docker.com/_/orientdb/) as opposed to having to install Java and a local instance of OrientDB on their development machines.

While this works great for development, we couldn't apply it to the VSTS CI build to run integration tests as the agents were Windows-based and didn't have Docker installed. The workaround was to spin up a local instance of OrientDB if an existing one couldn't be found. This means that developers could still run tests as they'd have an existing, reachable instance of OrientDB running in Docker, while during the CI build a local instance would be created.

This worked fine, but required more code to create the new OrientDB instance, and also meant we didn't have consistency between the dev and CI setups. When the Linux Hosted pool showed up on the Readify tenant of VSTS, we decided to give it a go and try to run OrientDB in Docker.

## Running a Docker container as part of the CI build

Out of the box, VSTS doesn't provide tasks to run Docker workloads. Fortunately, [an extension](https://marketplace.visualstudio.com/items?itemName=ms-vscs-rm.docker) backed by Microsoft exists on the Visual Studio Marketplace. The code is hosted in the [vsts-docker GitHub repo](https://github.com/Microsoft/VSTS-Docker) for the curious ones who want to have a look at it.

The extension brings 3 new tasks:

 - Docker: to build, push or run Docker images. It can also run custom Docker commands
 - Docker Compose: to build, push or run multi-container Docker applications
 - Docker Deploy: this one allows use to deploy single or multi-container Docker applications to Azure Container Services

 We are here only interested in running a Docker container, so the first task will suffice our needs.

 ![Run an OrientDB container](/public/images/posts/5-vsts-docker/run-docker-container.png)

 As you can see, it takes the parameters you would expect:

  - The name of the image
  - The name of the container
  - Port mapping
  - Volume mapping
  - Environment variables

Remember that if this doesn't suit your needs, you can always fall back to running a custom docker command that would allow you to specify all the parameters yourself.

## Connecting to the Docker container

There was an issue where the tests couldn't connect to the OrientDB database when running on the CI build. The error message was `Connection refused 127.0.0.1:2424`. It took a while to figure out, but since the VSTS agent is not the Docker host, it's normal that the OrientDB container is not reachable through localhost. This means we need to figure out the IP address of the OrientDB container and connecting using this IP.

### Getting the IP of the OrientDB container

That was easy. I mean, the first Google search pointed to a [serverfault question](http://stackoverflow.com/questions/17157721/getting-a-docker-containers-ip-address-from-the-host) that explains how. `docker inspect` returns information about the container, and the `--format` option allows you to specify what *portion* you want back. To only get the IP address, you can run:

{% raw %}
`docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' container_name_or_id`
{% endraw %}

### Have the tests use this IP

The tests get the OrientDB connection information through the [configuration model](https://docs.microsoft.com/en-us/aspnet/core/fundamentals/configuration) of ASP.NET Core to get information about how to connect to OrientDB. It's a provider-based model, which means you can add several sources of different types to the configuration. Providers added last can override configuration values added by previous providers; in other words, the last provider has the highest priority.

During development, all the settings are read from a JSON file. This can't work for CI since the IP address of the OrientDB container could change between runs - even though a few tries showed it wasn't the case. One option to override the hostname specified in the JSON file is to create an environment variable using the same name as the config setting. Environment variables are added last so they'll take precedence. The configuration code then looks like:

```csharp
var configuration = new ConfigurationBuilder()
    .SetBasePath(Directory.GetCurrentDirectory())
    .AddJsonFile("appsettings.json")
    .AddEnvironmentVariables()
    .Build();
```

and here's the JSON file:

```json
{
  "OrientDB": {
    "Port": "2424",
    "Username": "root",
    "Password": "verysecurepassword",
    "Host": "localhost"
  }
}
```

The goal is then to create an environment variable with the name `OrientDB:Host` and  set it to the IP address of the OrientDB container. We saw that getting the IP was easy, but how do we create an environment variable as part of the build? VSTS has the concept of [logging commands](https://github.com/Microsoft/vsts-tasks/blob/master/docs/authoring/commands.md). Emitting specific text through the standard output means VSTS will parse that output and react appropriately. One of these commands can create an environment variable, the format is the following:

`##vso[task.setvariable variable=<variable-name>;]<variable-value>`

The solution was then to include a [bash script](https://www.visualstudio.com/en-us/docs/build/steps/utility/shell-script) task in the CI build - remember, this is a Linux agent we're running on - to get the IP and output the appropriate logging command. Overall it looks something like:

{% raw %}
```bash
#!/bin/bash

IP=`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' orientdb`
echo "##vso[task.setvariable variable=OrientDB:Host;]$IP"
```
{% endraw %}

The tests now happily pick up the container's IP address from the environment variable via the ASP.NET Core configuration model.

## Other challenges when running in Linux

A few other things had to be changed for the build to run smoothly. The first one was folder separators in the various build tasks, as Linux uses `/`. We also had some code where backslashes were used in strings to represent paths; switching over to `Path.Combine` fixed this.

The file system on Linux is also case-sensitive, so `myproject.tests` and `MyProject.Tests` are two different things. We had a few occurences of this that needed updating.

Finally, we have some scripts in the git repository to setup dummy data before running each integration test. They are prefixed with numbers to indicate you need to run them sequentially for them to work properly. We found out that, on Linux, `Directory.EnumerateFiles` doesn't return files in alphabetical order, while it does on Windows. We had to sort them manually before iterating over them.

Overall, it took some time to get this working, and at some point a lot of trial & error when running the builds to figure out what was happening, but we now have a CI build that is consistent with what happens during development.