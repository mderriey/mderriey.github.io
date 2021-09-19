---
layout: post
title: How to use AAD authentication to Azure Service Bus with NServiceBus
description: In this post we look at how we can leverage Azure Active Directory authentication to Azure Service Bus with NServiceBus to free ourselves of access keys.
---

# Introduction

In an effort to improve the security of our applications, we consistently strive to use Azure Active Directory authentication to Azure services.

In doing so, we free ourselves of having to secure sensitive information:

1. AAD authentication relies on tokens the application can acquire at runtime, meaning we don't need access keys or connection strings with passwords.
1. Thanks to [Azure managed identities](https://docs.microsoft.com/en-us/azure/active-directory/managed-identities-azure-resources/overview), our applications have access to the necessary credentials when they run in Azure.

We use AAD authentication to connect to a variety of services already: Azure SQL, Azure Blobs and Queues, Azure Key Vault, and App Configuration.

We recently investigated how we could do the same to connect to Azure Service Bus.

## Current landscape

Instead of integrating directly with Azure Service Bus, we use NServiceBus, which brings a tonne of benefits:

- It is transport-agnostic, which means we can run our messaging solutions locally by targetting RabbitMQ with minimal code changes.
- Reliability and recoverability are built-in concepts, so it is extremely easy to define complex retry policies when a processing error occurs.
- NServiceBus can audit all processed messages to a centralised location for better traceability and troubleshooting.

This also means that we delegate the responsibility of integrating with Azure Service Bus to NServiceBus.
At the time of writing, the [Azure Service Bus transport NuGet package](https://www.nuget.org/packages/NServiceBus.Transport.AzureServiceBus/) for NServiceBus depends on an older Azure Service Bus client library, Microsoft.Azure.ServiceBus.

A newer library, called Azure.Messaging.ServiceBus, was released a few months back.
That new library is part of the new Azure SDK, which brings a consistent way to use AAD authentication across all the client libraries thanks to Azure.Identity.
It's worth nothing that upgrading the NServiceBus transport to the new Azure.Messaging.ServiceBus library is tracked in a GitHub issue over at <https://github.com/Particular/NServiceBus.Transport.AzureServiceBus/issues/361>.

We still want to leverage AAD authentication, so we decided to perform a multi-step investigation:

1. Does Microsoft.Azure.ServiceBus support AAD authentication? If it doesn't, we'll need to wait for the transport to use the new library.
1. If it does support AAD authentication, does NServiceBus expose the necessary extensilibity points for us to use it?
1. Finally, can we leverage Azure.Identity with an older library that's not part of the new Azure SDK?

Let us perform some detective work.

## The investigation

### Part one

We first want to find out whether the Microsoft.Azure.ServiceBus library supports AAD authentication.

Unfortunately, it wasn't as easy as we expected to find out.
After some searching through the samples looking for specific keywords like AAD, token, or managed identity, we found the [following sample on GitHub](https://github.com/Azure-Samples/app-service-msi-servicebus-dotnet/blob/03be4e05b5803e464d416b66fd729d23bd4220fb/WebAppServiceBus/WebAppServiceBus/Controllers/HomeController.cs#L62-L65):

```csharp
var tokenProvider = TokenProvider.CreateManagedServiceIdentityTokenProvider();
QueueClient sendClient = new QueueClient($"sb://{Config.Namespace}.servicebus.windows.net/", Config.Queue, tokenProvider);
await sendClient.SendAsync(new Message(Encoding.UTF8.GetBytes(messageInfo.MessageToSend)));
await sendClient.CloseAsync();
```

Great news!
We can see in this sample that the connection string doesn't contain any access keys, and we use a token provider instead, which we suspect the client library uses internally to acquire a token.

Looking into it a bit further, there is an [`ITokenProvider` abstraction](https://github.com/Azure/azure-sdk-for-net/blob/Microsoft.Azure.ServiceBus_5.1.3/sdk/servicebus/Microsoft.Azure.ServiceBus/src/Primitives/ITokenProvider.cs) with 3 built-in implementations:

1. The first one is [`SharedAccessSignatureTokenProvider`](https://github.com/Azure/azure-sdk-for-net/blob/Microsoft.Azure.ServiceBus_5.1.3/sdk/servicebus/Microsoft.Azure.ServiceBus/src/Primitives/SharedAccessSignatureTokenProvider.cs), which generates tokens from a shared access key &mdash; this is what we want to stay away from.
1. The second one is [`AzureActiveDirectoryTokenProvider`](https://github.com/Azure/azure-sdk-for-net/blob/Microsoft.Azure.ServiceBus_5.1.3/sdk/servicebus/Microsoft.Azure.ServiceBus/src/Primitives/AzureActiveDirectoryTokenProvider.cs) where the consumer has full control over the token acquisition process by passing in a delegate.
1. Finally, the last one is [`ManagedIdentityTokenProvider`](https://github.com/Azure/azure-sdk-for-net/blob/Microsoft.Azure.ServiceBus_5.1.3/sdk/servicebus/Microsoft.Azure.ServiceBus/src/Primitives/ManagedIdentityTokenProvider.cs), which uses the Microsoft.Azure.Services.AppAuthentication library to acquire a token.

We'll get back to this, but for now, let's see if NServiceBus exposes a way for us to provide a token provider.

### Part two

We're now focussing on the Azure Service Bus transport for NServiceBus.

Much easier this time, as [the documentation page](https://docs.particular.net/transports/azure-service-bus/configuration#connectivity) listing all configuration options for this transport has a "Connectivity" section, indicating that a token provider can be provided.

Two for two for now!

### Part three

As a reminder, what we're evaluating here is whether we can use Azure.Identity with the Microsoft.Azure.ServiceBus library, which doesn't support it natively.

❓ _Why bother since we found a token provider that can leverage Azure managed identities already_ ❓

That's a good question;
when we think about it, we could use the built-in token provider.
However, there's two reasons we want to use Azure.Identity:

1. The main one is that Microsoft.Azure.Services.AppAuthentication is no longer recommended to use, and Azure.Identity should be used for all new development &mdash; see the [official Microsoft documentation](https://docs.microsoft.com/en-us/dotnet/api/overview/azure/service-to-service-authentication).
1. The second one is that most our integrations using AAD authentication use Azure.Identity, so it makes sense for us to keep a single ubiquitous library to perform token acquisition.

We're lucky here because the [`ManagedIdentityTokenProvider`](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/servicebus/Microsoft.Azure.ServiceBus/src/Primitives/ManagedIdentityTokenProvider.cs) gives us a great starting point.
In fact, our implementation is very similar, only swapping one library for another.

```csharp
TODO
```

We tested this and confirmed that it's working as expected.

## Putting it all together

Now that we have all the information, here's a sample showing how to leverage AAD authentication to Azure Service Bus with NServiceBus:

```csharp
TODO
```

## Conclusion

We first went through the benefits of using AAD authentication within our applications, as it allows us to remove access keys and passwords from our configuration.

We then had a look at the current state of the Azure Service Bus transport for NServiceBus, and how it's using an older library that might not support AAD authentication.

Followed an investigation piece where we confirmed three things:

1. Microsoft.Azure.ServiceBus supports AAD authentication.
1. We can leverage that capability when using NServiceBus.
1. We implemented an authentication provider based on Azure.Identity.

Finally, we saw in a sample how we could put all the pieces of the puzzle together.

Additional links:

- Azure Active Directory authentication to Azure Service Bus: <https://docs.microsoft.com/en-us/azure/service-bus-messaging/service-bus-managed-service-identity>.
- Sample to authenticate to Azure Service Bus with Azure managed identities: <https://github.com/Azure-Samples/app-service-msi-servicebus-dotnet/tree/03be4e05b5803e464d416b66fd729d23bd4220fb>.
- GitHub issue to track the update of the underlying Azure Service Bus library in NServiceBus: <https://github.com/Particular/NServiceBus.Transport.AzureServiceBus/issues/361>.
