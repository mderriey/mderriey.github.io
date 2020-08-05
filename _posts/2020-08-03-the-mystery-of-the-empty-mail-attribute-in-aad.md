---
layout: post
title: The mystery of the empty mail attribute in AAD
description: A tale of an issue we recently encountered that prevented users from registering for SSPR and MFA
---

# Introduction

At [Telstra Purple](https://purple.telstra.com), we recently launched a new internal Office 365 tenant.
The main goal was to give employees from different acquisitions made by Telstra through the years a single roof, which would make collaboration easier.

In early June, we onboarded the first 300 users.
Unfortunately, we hit an issue that affected a high number of users, which prevented them from getting control of their new account.

In this post, we'll go through how we designed the onboarding process, what went wrong, and how we fixed the issue.

## The onboarding process

Let's first discuss what a working onboarding process looks like.

There are two main steps an employee needs to take:

1. Go through the self-service password reset (SSPR) flow to pick a password; then
1. Register for SSPR and multi-factor authentication (MFA).

In our case, the impacted users faced an issue during the second phase of the account claiming process.
Before we dive in the issue, let's expand on the strategy we put in place.

### Self-service password reset

The main thing is that we don't want to handle employees' passwords, nor do we want to communicate it to them via email, even if it's possible to force them to update it the first time they use it to log in.
Instead, we want users to pick a password themselves from the get-go.

To achieve this, we leverage the [self-service password reset capability](https://docs.microsoft.com/en-us/azure/active-directory/authentication/tutorial-enable-sspr) of Azure Active Directory.
It not only allows employees to pick a password themselves when they get onboarded, it also provides them with a way to reset their password if they forget it or get locked out of their account.
Less helpdesk involvement means it's a win-win situation for everyone.

Our automation pre-seeds 2 pieces of information from our HR system to ensure that only an employee can reset the password for their account:

- A mobile phone number; and
- An alternate email address.

The SSPR process then goes like this:

- A user navigates to <https://aka.ms/sspr> and enters the username they've been communicated;
- They then need to validate ownership of both the mobile number and the alternate email address associated with their account;
- Finally, they can choose a new password.

At this stage, the user can log in with their new account.
However, because our directory is configured to enforce self-service password reset and multi-factor authentication, the first time they use their new password, they will be presented with a sign-in interruption indicating they need to perform additional steps.

![AAD sign-in interruption](/public/images/posts/2020-08-04-empty-mail-attribute-in-aad/multi-factor-authentication-initial-prompt.png)
<small><i>Source: <https://docs.microsoft.com/en-us/azure/active-directory/user-help/multi-factor-authentication-end-user-first-time#open-the-additional-security-verification-page></i></small>

### SSPR and MFA registration

> But wait! If they reset their password already, why do they need to register for SSPR?

I know, right?
While the automation seeded information against their account to allow them to initally reset their password, Azure Active Directory still needs them to manually register information for self-service password reset.

It's now time for our employees to register for self-service password reset and multi-factor authentication.
The goal here is for users to provide information that will allow them to both reset their password themselves, as well as be able to complete MFA challenges when they sign in.

Because the information users would provide in those two steps are the same, we take advantage of the [combined registration for SSPR and MFA](https://docs.microsoft.com/en-us/azure/active-directory/authentication/concept-registration-mfa-sspr-combined) in AAD.
The benefits of using this approach are two-fold.
First, it means users only need to provide security information once.
It also reduces confusion, as otherwise they would get two separate sign-in interruptions &mdash; one for SSPR registration, and another one for MFA registration &mdash; and could think that the first registration didn't work properly.

## The issue

During the SSPR and MFA registration, users are required to provide and verify both a mobile number and an alternate email address.

At this stage, some employees would face this issue:

1. They provided their mobile phone number;
1. They received a code via text;
1. When keying the code in, the verification wouldn't work.

![Error faced when verifying the mobile phone number](/public/images/posts/2020-08-04-empty-mail-attribute-in-aad/error-while-verifying-mobile-number.png)
<small><i>The error some users faced when attempting to verify their mobile phone number.</i></small>

Let's now discuss how we investigated and fixed this issue.

## The investigation

We launched the new tenant during lockdown, while many organisations were moving to the cloud to support remote work.
There was also an open service advistory impacting some systems.

Associated with the fact that some users could still complete the whole process without any trouble, we thought it was a transient issue, and decided to wait for the next morning.
Unfortunately, the error persisted the next day, and we opened a support case with Microsoft.

While waiting for a response, we analysed the AAD audit logs, and found something interesting:

- Users who could complete the SSPR and MFA registration never encountered this issue; and
- No user who experienced this issue successfully completed the process on subsequent attempts.

This clear dichotomy, linked with the fact that time itself didn't fix anything, reinforced the idea that this wasn't a transient issue.

## The cause

Upon further investigation, we finally found the common denominator between all the users who couldn't complete the process: in AAD, their `mail` attribute was empty!
For other users, it would be filled with the primary SMTP address of their Exchange mailbox.

It was great to have a potential lead, but what could we do about it?
My high-level understanding is that the `mail` attribute in AAD is read-only, and is internally set by Exchange when a mailbox is created for a user.
So how could we get it updated?

My colleague [Rob McLeod](https://github.com/RobFaie) had a great idea: why don't we add an alias to their mailbox, and hope this will trigger Exchange to write that attribute back to AAD?
We first tested that theory manually through the Exchange admin center on a small number of users, and a few minutes later we gladly found out a few minutes later that the `mail` attribute for these users was populated.

We then asked these users to go through the SSPR and MFA registration process again, and it worked 🎉!

## How we fixed it

Because we didn't want to manually add a secondary email address to the mailbox of each impacted user, we decided to write a PowerShell script to take care of this, which looked something like this:

```powershell
Connect-AzureAD
Connect-ExchangeOnline

$aadStaffGroupName = '<name-of-group-containing-all-staff'
$aadStaffGroup = Get-AzureADGroup -SearchString $aadStaffGroupName

#
# We use -All:$true because AAD only returns the first 100 members by default
# We also know that this group doesn't contain nested groups, so we don't need to cater for that
#
$staffWithoutMailAttribute = Get-AzureADGroupMember -ObjectId $aadStaffGroup.ObjectId -All:$true | Where-Object { [string]::IsNullOrEmpty($_.Mail) }

foreach ($userWithoutMailAttribute in $staffWithoutMailAttribute) {

    #
    # Like in many organisations, the username and email address are the same
    #
    $userMailbox = Get-Mailbox -Identity $userWithoutMailAttribute.UserPrincipalName

    #
    # 'smtp' means secondary email address, while 'SMTP' means primary email address
    # See https://docs.microsoft.com/en-us/powershell/module/exchange/set-mailbox
    #
    $secondaryEmailAddress = 'smtp:{0}.forcemailwriteback@purple.telstra.com' -f $userMailbox.Alias
    Set-Mailbox -Identity $userWithoutMailAttribute.UserPrincipalName -EmailAddresses @{ Add = $secondaryEmailAddress }
}

#
# Periodically query AAD until all users have the `mail` attribute filled out
#
$numberOfUsersWithoutMailAttribute = $staffWithoutMailAttribute | Measure-Object | Select-Object -ExpandProperty Count
while ($numberOfUsersWithoutMailAttribute -gt 0) {
    Start-Sleep -Seconds 60

    $staffWithoutMailAttribute = Get-AzureADGroupMember -ObjectId $aadStaffGroup.ObjectId -All:$true | Where-Object { [string]::IsNullOrEmpty($_.Mail) }
    $numberOfUsersWithoutMailAttribute = $staffWithoutMailAttribute | Measure-Object | Select-Object -ExpandProperty Count
}
```

When affected users then reported back they could then complete the process, we wrote a similar script to remove the temporary secondary email address added in the above script.

## Why this happened in the first place

When Microsoft responded to our support request, we shared our findings with them, but we never found out why the `mail` attribute hadn't initally been populated for these users.
All the employees have been assigned licenses around the same time and through automation, so there's nothing on our end that we did differently for some of them.

If you're reading this and you have an idea, I'd love for you to [reach out to me on Twitter](https://twitter.com/mderriey).

## Conclusion

In this post, we first described what the onboarding process in our new tenant is.
We then discussed the issue that some users faced when going through the SSPR and MFA registration, along with the steps of our investigation to find our what the cause was.
Next was the manual process to validate and fix the issue.
Finally, we saw how we automated fixing this issue, to allow the impacted users to get control of their new account.

Cheers for making it all the way down here 🙇‍♂️.
