---
layout: post
title: Correlation ID with ASP.NET Web API
description: How to make sure all the HTTP responses contain a unique ID for tracing/debugging purposes
---

I'm currently working at a client where I build a Web API. It's important for them that every call the API can be tracked for tracing/debugging purposes. The perfect candidate for that is a correlation ID, which uniquely identifies each request.

Now there's 2 things we have to take care of for it to be usable later:

 - communicate it to the client
 - include it in every log entry of each specific request

In this post we'll see how to achieve that.

### Communicating the correlation ID back to the client

An easy way to do this is to include it in a custom header of the HTTP response. Since it's a global behaviour, we can use a message handler to do this. I like to think about [Message Handlers](https://www.asp.net/web-api/overview/advanced/http-message-handlers) as a pipeline you have access to before the request makes its way to the controller.

Here the simple bit of code:

```csharp
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace WebApi.CorrelationId.MessageHandlers
{
    public class AddCorrelationIdToResponseHandler : DelegatingHandler
    {
        private const string CorrelationIdHeaderName = "X-Correlation-Id";

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var responseMessage = await base.SendAsync(request, cancellationToken);

            responseMessage
                .Headers
                .Add(CorrelationIdHeaderName, request.GetCorrelationId().ToString());

            return responseMessage;
        }
    }
}
```

We also need to add this message handler to the ASP.NET Web API configuration:

```csharp
var httpConfiguration = new HttpConfiguration();

// your regular configuration

httpConfiguration.MessageHandlers.Add(new AddCorrelationIdToResponseHandler());
```

Very easy indeed. Let the request execute, and just before letting the response go "up" the pipeline, add a new header to it. I also take advantage of ASP.NET Web API having the correlation ID built-in thanks to [an extension method on `HttpRequestMessage`](https://msdn.microsoft.com/en-us/library/system.net.http.httprequestmessageextensions.getcorrelationid(v=vs.118).aspx). The implementation of the method itself is pretty straightforward: check in the properties of the request if a correlation ID already exists; it does? great, return it. no luck? create one and store it in the request so the same one is returned for the lifetime of the request. You can check it [here](https://github.com/ASP-NET-MVC/aspnetwebstack/blob/4e40cdef9c8a8226685f95ef03b746bc8322aa92/src/System.Web.Http/HttpRequestMessageExtensions.cs#L758-L778).

### Including it in the logs

Every request will send a unique ID back to the client, but how can we correlate this to our own logging system? How can we know what happened during a request if we're given a correlation ID?

In this case, I'm using the awesome logging library Serilog, and it's again very easy to achieve what we want. Serilog has a notion of [log context](https://github.com/serilog/serilog/wiki/Enrichment#the-logcontext) which allows us to add properties for a certain time. We know we want that ID for the lifetime of the request, so again a message handler fits perfectly:

```csharp
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Serilog.Context;

namespace WebApi.CorrelationId.MessageHandlers
{
    public class AddCorrelationIdToLogContextHandler : DelegatingHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            using (LogContext.PushProperty("CorrelationId", request.GetCorrelationId()))
            {
                return await base.SendAsync(request, cancellationToken);
            }
        }
    }
}
```

The `using` keyword makes it very easy to understand that the property `CorrelationId` will be in the log context during the whole request. Serilog now needs to be aware that we intend to enrich the logging context with the `LogContext` and that we expect the `CorrelationId` property to be output for every log entry.

```csharp
var logger = new LoggerConfiguration()
    .WriteTo.LiterateConsole(outputTemplate: "[{Timestamp:HH:mm:ss} {Level} {CorrelationId}] {Message}{NewLine}{Exception}")
    .EnrichWith.LogContext()
    .CreateLogger();
```

Because the default output template doesn't know about our custom property, it's just a matter of including it. Like for the first message handler, we have to include it in the configuration for it to be run.

As an example, if we declare a very simple controller:

```csharp
using System.Web.Http;
using Serilog;

namespace WebApi.CorrelationId
{
    public class HomeController : ApiController
    {
        [Route("home")]
        public void Get()
        {
            Log.Information("Executing /home");
        }
    }
}
```

Here's what gets output in the console:

![Log in the console](/public/images/posts/4/log-in-the-console.png)

### What about ASP.NET MVC Core?

I wondered how different this would be to achieve with ASP.NET MVC Core. It turns out the idea is the same, but the implementation is a bit different. Message handlers don't exist anymore, so we have to write ASP.NET Core middlewares.

```csharp
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace AspNetMvcCore.CorrelationId.Middleware
{
    public class AddCorrelationIdToResponseMiddleware
    {
        private const string CorrelationIdHeaderName = "X-Correlation-Id";
        private readonly RequestDelegate _next;

        public AddCorrelationIdToResponseMiddleware(RequestDelegate next)
        {
            _next = next;
        }

        public Task Invoke(HttpContext context)
        {
            context
                .Response
                .Headers
                .Add(CorrelationIdHeaderName, context.TraceIdentifier);

            return _next(context);
        }
    }
}
```

```csharp
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Serilog.Context;

namespace AspNetMvcCore.CorrelationId.Middleware
{
    public class AddCorrelationIdToLogContextMiddleware
    {
        private readonly RequestDelegate _next;

        public AddCorrelationIdToLogContextMiddleware(RequestDelegate next)
        {
            _next = next;
        }

        public Task Invoke(HttpContext context)
        {
            using (LogContext.PushProperty("CorrelationId", context.TraceIdentifier))
            {
                return _next(context);
            }
        }
    }
}
```

The Serilog configuration, however, stays exactly the same.

You can find the code associated with this post on [GitHub](https://github.com/mderriey/web-api-correlation-id).