---
layout: post
title: The consequences of enabling the "user assignment required" option in AAD apps
description: What consequences does turning the "user assignment required" option have on applications?
---

# Introduction

Applications in Azure Active Directory have an option labelled "user assignment required". In this blog post, we'll talk about how this affects an application.

> 💡 Quick heads-up &mdash; all the examples in this blog post are based on a web application using AAD as its identity provider through the OpenID Connect protocol.

### Context

By default, applications created in Azure Active Directory have the "user assignment required" option turned off, which means that all the users in the directory can access the application, both members and guests.

While this might sound like a sensible default, we find ourselves at [Readify](https://readify.net) with a growing number of guests in the directory as we collaborate with people from other companies. Some of our applications contain data that should be available to Readify employees only, so we decided to make use of the "user assignment required" option.

To access this option, in the Azure portal, go to "Azure Active Directory > Enterprise applications > your application > Properties" and the option will be displayed there.

Some of the behaviour changes were expected, but others were not! Let's go through them.

### 1. People not assigned to the application can't use it

_Well, duh, isn't that what the option is supposed to do?!_

You're absolutely right! If someone that hasn't been explicitly assigned to the application tries to access it, then AAD will reject the authorisation request with a message similar to the following:

> AADSTS50105: The signed in user 'Microsoft.AzureAD.Telemetry.Diagnostics.PII' is not assigned to a role for the application '\<application-id>' (\<application-name>)

The message is straightforward and the behaviour expected.

There are several ways to assign someone to the application. I typically use the Azure portal, navigate to "Azure Active Directory > Enterprise applications > my application > Users and groups" and add them there.

### 2. Nested groups are not supported

This is the first surpise we had. It's our bad, because it's well documented on that documentation page in the "Important" note: https://docs.microsoft.com/en-us/azure/active-directory/users-groups-roles/groups-saasapps

In other words, if you assign a group to an application, only the direct members of that group will gain access to the application. So instead of using our top-level "all employees" type of group, we had to assign several lower-level groups which only had people inside of them.

### 3. All permissions need to be consented to by an AAD administrator

Applications in Azure Active Directory can request two types of permissions:

1. the permissions which are scoped to the end user, like "Access your calendar", "Read your user profile", "Modify your contacts" &mdash; these permissions are shown to the user the first time they access an application, and they can consent to the application performing those actions on behalf of them;
1. another type of permissions usually have a broader impact, outside of the user's scope, like "Read all users' profiles" or "Read and write all groups" &mdash; those permissions need to be consented to by an AAD administrator on behalf of all the users of the application.

When the access to the application is restricted via the "user assignment required", an Azure Active Directory administrator needs to consent to all the permissions requested by the application, no matter whether users can normally provide consent for them.

As an example, I created an application with only one permission called "Sign in and read user profile". After enabling the "user assignment required" option, I tried to log in through my web application and got prompted with a page similar to the screenshot below:

![AAD application requires admin approval after enabling the "user assignment required" option](/public/images/posts/aad-user-assignment-required/app-needs-admin-approval-after-enabling-user-assignment-required.png)

While I don't fully understand that behaviour, it is alluded to in the tooltip associated with the "user assignment required" option, shortened for brevity and emphasis mine.

> This option only functions with the following application types: [...] or applications built directly on the Azure AD application platform that use OAuth 2.0 / OpenID Connect Authentication **after a user or admin has consented to that application**.

The solution is to have an AAD admin grant consent to the permissions for the whole directory. In the Azure portal, go to "Azure Active Directory > Enterprise application > your application > Permissions" and click the "Grant admin consent" button.

### 4. Other applications not assigned to the application can't get an access token

It's not uncommon to see integration between applications. As an example, an application "A" could run a background job every night and call the API of application "B" to get some data.

Before we enabled the "user assignment required" option in application "B", it was possible for application "A" to request an access token to AAD, allowing it to call the API of application "B". This is done using the `client_credentials` OAuth2 flow, where application "A" authenticates itself against AAD with either a client secret (it's like a password, but an app can have different secrets) or a certificate.

However, after requiring users to be assigned to the application "A", the token request returns the following error:

> AADSTS501051: Application '\<application-b-id>' (\<application-b-name>) is not assigned to a role for the application '\<application-a-id>' (\<application-a-name>).

While it's similar to the first error we talked about in this post, the resolution is different, as the Azure portal doesn't let us assign applications to another application in the "User and groups" page.

I found the solution in [this Stack Overflow answer](https://stackoverflow.com/a/45839322/562839) which advises to take the following steps:

1. create a role in application "A" that can be assigned to applications;
1. have application "B" request this permission; and
1. get an AAD admin to grant consent for the permissions requested by application "B".

Let's go through these steps one by one.

##### 4.1 Create a role that can be assigned to applications

If you want to get some background information on AAD app roles, I highly suggest reading the following pages on `docs.microsoft.com`: [Application roles](https://docs.microsoft.com/en-us/azure/architecture/multitenant-identity/app-roles) and [Add app roles in your application and receive them in the token](https://docs.microsoft.com/en-us/azure/active-directory/develop/howto-add-app-roles-in-azure-ad-apps).

To create a role aimed at applications, we'll use the "Manifest" page and replace the `appRoles` property with the following:

```json
"appRoles": [{
  "allowedMemberTypes": ["Application"],
  "description": "Consumer apps have access to application A data",
  "displayName": "Access application A",
  "id": "1b4f816e-5eaf-48b9-8613-7923830595ad",
  "isEnabled": true,
  "value": "Access"
}]
```

##### 4.2 Request that permission in application "B"

_Wait, we were talking about creating a role and now we request a permission?_

I agree, sorry about the confusion, but the following will hopefully make sense. There's a change in the terminology we use because assigning that role to application "B" is actually done the other way around, by requesting that role from the settings of application "B".

To do so, we navigate in the Azure portal to "Azure Active Directory > App registrations > application "B" > Required permissions" and then click on the "Add" button. In the new "Add API Access", we look for application "A", select it, then pick the "Access application A" application permissions we created in the previous step:

![Request the permission to access the target application](/public/images/posts/aad-user-assignment-required/request-application-permission.png)

> 💡 Another heads-up &mdash; at the time of writing, the Azure portal has a new App registrations experience in preview. The steps mentioned above are for the GA App registrations blade, but the experience is pretty similar in the preview one. If you want to try it out, follow "App registrations (preview) > application "B" > API permissions > Add a permission > APIs my organization uses > application "A" > Application permissions", then finally pick the "Access application A" one.

##### 4.3 Grant consent for application "B" to access application "A"

Because there's no user involved, application permissions automatically require admin consent. Follow the steps taken previously, but this time for application "B". After doing so, the token request from application "B" to access application "A" will work as expected.

### Conclusion

When we first used that "user assignment required" option, I was only expecting unassigned users to be bounced by AAD when trying to log in. Little did I know we would encounter all those "bumps" along the way 🤣.

This was a great learning opportunity, and hopefully it'll be useful to others.