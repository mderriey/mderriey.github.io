---
layout: post
title: OpenID Connect and JS applications with `oidc-client-js`
description: How to delegate authentication and authorisation of a JS application to an OpenID Connect server
---

![OpenID Connect](/public/images/posts/3/openid-connect.png)

I've been using OpenID Connect for some time now.
OIDC is a specification built on top of OAuth 2 to which it adds authentication capabilities, where OAuth only provides autorisation.
It's been around for a couple of years now and big names in IT like [Google](https://developers.google.com/identity/protocols/OpenIDConnect) and [Microsoft](https://azure.microsoft.com/en-us/documentation/articles/active-directory-v2-protocols-oidc/) have adopted it.
If you want to know more about it, I would suggest reading the [official spec](http://openid.net/specs/openid-connect-core-1_0.html). If the specness of the document is a bit scary, the docs from [Google](https://developers.google.com/identity/protocols/OpenIDConnect) and [Microsoft](https://azure.microsoft.com/en-us/documentation/articles/active-directory-v2-protocols-oidc/) will feel more user-friendly.

### Hosting your own Identity Provider

Being a .NET developer, I came across [IdentityServer](https://identityserver.github.io/Documentation/), a .NET implementation of the OpenID Connect specification.
This means you can run your OpenID Connect compliant server in less than 10 minutes.
The creators and main contributors of the project, [Dominick Baier](https://twitter.com/leastprivilege) and [Brock Allen](https://twitter.com/BrockLAllen), have been doing a wonderful job over the years as IdentityServer is extensible and very easy to use.


Out of the box, it comes with several adapters, so you can hook it with [ASP.NET Identity](https://github.com/IdentityServer/IdentityServer3.AspNetIdentity) or [MembershipReboot](https://github.com/brockallen/BrockAllen.MembershipReboot), Brock Allen's own vision of what an identity management and authentication system should look like.
You can also store IdentityServer's configuration with [Entity Framework](https://github.com/IdentityServer/IdentityServer3.EntityFramework).

Last but not least, the team is already working on an [ASP.NET Core](https://github.com/IdentityServer/IdentityServer4) version.

### What about client applications?

Identity Server also comes with a library that allows to protect your ASP.NET Web API [with Identity Server](https://github.com/IdentityServer/IdentityServer3.AccessTokenValidation) in minutes.
Wiring it is so easy you might forget how much complexity it takes care of.
There can be many roundtrips between your client application and the Identity Provider, and the client has to validate the [different](http://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation) [tokens](http://openid.net/specs/openid-connect-core-1_0.html#ImplicitTokenValidation) it receives.
The validation can involve X.509 certificates, encryption and hashing algorithms and other non-trivial operations.

### What does it take to create a JS client application?

You might be wondering how much work would be involved if you were to create a JS-only application that would delegate authentication to an OpenID Connect provider.
Getting tokens, validating them, renewing them when they are about to expire...

The IdentityServer team had created [`oidc-token-manager`](https://github.com/IdentityModel/oidc-token-manager) which took care of most aspects of dealing with an OpenID Connect identity provider.

A specific aspect of JS applications built with OpenID Connect is the [session management](http://openid.net/specs/openid-connect-session-1_0.html).
In a nutshell, it allows the JS application to be notified if the user's session state at the IdP has changed - let's say because they logged out.
Implementing that feature in a JS application is not trivial since, to minimise network traffic between the application and the IdP, it is based on the client application loading a hidden `iframe` from the IdP and polling it with the `postMessage` API.

While being an amazing library, `oidc-token-manager` didn't help much when it came to implementing that specific feature.

Luckily for us, the Identity Server has been hard at work and created [`oidc-client-js`](https://github.com/IdentityModel/oidc-client-js), the successor of `oidc-token-manager`.
From their creators:

> [oidc-client-js is a] library to provide OpenID Connect (OIDC) and OAuth2 protocol support for client-side, browser-based JavaScript client applications. Also included is support for user session and access token management.

### Wait, user session management?!

That's right, user session management!
And it's [enabled by default](https://github.com/IdentityModel/oidc-client-js/wiki#configuration) - look for `monitorSession`.

This means that as soon as a user is logged in, the library takes care of creating the hidden `iframe` from the OIDC IdP, and polls it at a regular and configurable interval to be aware of a potential change in the user session. Madness!
If it detects it's changed, it will raise an event that's very easy to handle

For those who have already used `oidc-token-manager`, the API is similar, so it's pretty easy to make the shift.

### Show me the code!

Here's a small commented example of what the library can do.

```js
var settings = {
    // URL of your OpenID Connect server.
    // The library uses it to access the metadata document
    authority: 'https://localhost:44300',

    client_id: 'js',

    popup_redirect_uri: 'http://localhost:56668/popup.html',
    silent_redirect_uri: 'http://localhost:56668/silent-renew.html',
    post_logout_redirect_uri: 'http://localhost:56668/index.html',

    // What you expect back from The IdP.
    // In that case, like for all JS-based applications, an identity token
    // and an access token
    response_type: 'id_token token',

    // Scopes requested during the authorisation request
    scope: 'openid profile email api',

    // Number of seconds before the token expires to trigger
    // the `tokenExpiring` event
    accessTokenExpiringNotificationTime: 4,

    // Do we want to renew the access token automatically when it's
    // about to expire?
    automaticSilentRenew: true,

    // Do we want to filter OIDC protocal-specific claims from the response?
    filterProtocolClaims: true
};

// `UserManager` is the main class exposed by the library
var manager = new Oidc.UserManager(settings);
var user;

// You can hook a logger to the library.
// Conveniently, the methods exposed by the logger match
// the `console` object
Oidc.Log.logger = console;

// When a user logs in successfully or a token is renewed, the `userLoaded`
// event is fired. the `addUserLoaded` method allows to register a callback to
// that event
manager.events.addUserLoaded(function (loadedUser) {
    user = loadedUser;
    display('.js-user', user);
});

// Same mechanism for when the automatic renewal of a token fails
manager.events.addSilentRenewError(function (error) {
    console.error('error while renewing the access token', error);
});

// When the automatic session management feature detects a change in
// the user session state, the `userSignedOut` event is fired.
manager.events.addUserSignedOut(function () {
    alert('The user has signed out');
});

// In that case, we want the library to open a popup for the user
// to log in. Another possibility is to load the login form in the main window.
$('.js-login').on('click', function () {
    manager
        .signinPopup()
        .catch(function (error) {
            console.error('error while logging in through the popup', error);
        });
});

// Here we want to redirect the user to the IdP logout page in the main window.
// We can also choose to do it in a hidden `iframe`
$('.js-logout').on('click', function () {
    manager
        .signoutRedirect()
        .catch(function (error) {
            console.error('error while signing out user', error);
        });
});
```

As you can see, using the library is very easy.
It's also worth to mention that if you're using TypeScript, you're covered as the library also comes with [a definition file](https://github.com/IdentityModel/oidc-client-js/blob/464d01c2d89a90ac41d8253d835a5a3c2e18cfbd/oidc-client.d.ts).
If you want to try using `oidc-client-js`, the [Identity Server JS walkthrough](https://identityserver.github.io/Documentation/docsv2/overview/jsGettingStarted.html) has been updated to use it.
