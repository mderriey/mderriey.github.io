---
layout: post
title: Playing with TFS webhooks and REST API
---

![WebHooks]({{ site.baseurl}}public/images/posts/2/webhooks.jpg)

I'm working on a project that contains 100+ git repositories. They are linked in the sense that the *main* repository has dependencies on the other ones.

An issue we're facing comes from the fact that the CI build is only triggered when a PR is merged on that *main* repo, which is far from being the most active one. As a result we have to manually queue a build every time a PR on any other repo is merged.

To overcome this, I've decided to play with TFS webhooks and the REST API. The idea is to be notified by a webhook when a pull request on any repo is merged so we can queue a build for the *main* repository through the REST API.

### What are webhooks?

[Webhooks](https://en.wikipedia.org/wiki/Webhook) are a way for applications to provide notifications to external systems when specific events occur. Most of the time, the source application makes an HTTP request to the URL configured for the webhook, passing relevant data depending on the event. Several services provide webhooks support, like [GitHub](https://developer.github.com/webhooks/) or [Slack](https://api.slack.com/outgoing-webhooks).

TFS 2015 and VSTS also support [webhooks](https://www.visualstudio.com/en-us/docs/service-hooks/services/webhooks) for a variety of [events](https://www.visualstudio.com/docs/integrate/get-started/service-hooks/events). In our case the one we're interested in it is when [a pull request is updated](https://www.visualstudio.com/docs/integrate/get-started/service-hooks/events#git.pullrequest.updated)

> I hear you saying that the [pull request merged](https://www.visualstudio.com/docs/integrate/get-started/service-hooks/events#git.pullrequest.merged) event suits perfectly our needs. You're right, but these docs are for VSTS, and TFS - 2015 Update 2, which we're using - does not support this event.

### Great! So how do we put everything together?

While my first idea was to create a hand-rolled API to get these notifications, a quick online search pointed me to [ASP.NET WebHooks](https://github.com/aspnet/WebHooks), a library to produce and consume webhooks.

Out of the box, it provides several connectors to consume webhooks from different services, one of which is [VSTS](https://github.com/aspnet/WebHooks/blob/master/samples/VstsReceiver).

Despite still being a pre-release, I decided to give it a go. It turned out to be very easy to setup. The [official documentation](https://docs.asp.net/projects/webhooks/en/latest/) was quite slim, but the [extensive samples](https://github.com/aspnet/WebHooks/tree/master/samples) made up for it. This library is distributed via NuGet with the `Microsoft.AspNet.WebHooks.Receivers` and `Microsoft.AspNet.WebHooks.Receivers.VSTS` packages.

Enabling webhooks support is a matter of calling an extensoin method on the `HttpConfiguration` class.

```csharp
public class Startup
{
    public void Configuration(IAppBuilder app)
    {
        var httpConfiguration = new HttpConfiguration();
        httpConfiguration.MapHttpAttributeRoutes();
        httpConfiguration.InitializeReceiveVstsWebHooks();

        app.UseWebApi(httpConfiguration);
    }
}
```

The next step is to create a handler class that gets registered automatically through ASP.NET Web API assembly resolution system.

```csharp
public class VstsWebHookHandler : VstsWebHookHandlerBase
{
    public override async Task ExecuteAsync(WebHookHandlerContext context, GitPullRequestUpdatedPayload payload)
    {
        return Task.FromResult(true);
    }
}
```

The base class defines [multiple virtual methods](https://github.com/aspnet/WebHooks/blob/master/src/Microsoft.AspNet.WebHooks.Receivers.VSTS/Handlers/VstsWebHookHandlerBase.cs), one for each supported TFS event. The `GitPullRequestUpdatedPayload` class is a strong;y-typed representation of the JSON payload TFS sends as part of the request. It contains lots of information such as the repository on which the pull request was created, the target branch or the status of the pull request.

### Queuing a new build

If the pull request matches our criteria, we can queue a new build by calling the [TFS REST API](https://www.visualstudio.com/en-us/docs/integrate/api/overview).

Again, I was thinking of using the `HttpClient` class to do so, but there's an official [.NET client library](https://www.visualstudio.com/en-us/docs/integrate/get-started/client-libraries/dotnet). Several NuGet packages must be installed in this case:

 - `Microsoft.TeamFoundationServer.Client`
 - `Microsoft.VisualStudio.Services.Client`
 - `Microsoft.VisualStudio.Services.InteractiveClient`

The .NET API is not very discoverable, and the documentation is here very sparse, but queuing a build is easy

```csharp
var connection = new VssConnection(
    new Uri("https://tfs/DefaultCollection"),
    new VssCredentials(true)); // Use default credentials

var buildClient = await connection.GetClientAsync<BuildHttpClient>();
var buildDefinitions = await buildClient.GetBuildDefinitionsAsync("TeamProjectName", "BuildDefinitionName");

if (buildDefinitions.Count > 0)
{
    var buildDefinition = buildDefinitions[0];
    var newBuild = new Build
    {
        Definition = new DefinitionReference
        {
            Id = buildDefinition.Id
        },
        Project = buildDefinition.Project
    };

    await buildClient.QueueBuildAsync(newBuild);
}
```

### Going one step further

In our case, working on a feature often involves working on different repositories, hence multiple PRs. Since we don't want to queue *n* PRs related to a single feature, some smarts were introduced so a new build is not queued if there's already one in the queue - not currently running.

You can have a look at the solution we ended up with on [this GitHub repository](https://github.com/mderriey/tfs-webhooks). While the NTLM authentication works with an on-premise installation of TFS, it would require some modifications to work with VSTS.
