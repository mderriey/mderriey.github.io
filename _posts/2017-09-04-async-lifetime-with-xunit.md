---
layout: post
title: Asynchronous initialisation and cleanup operations with xUnit
description: How to run asynchronous operations as part of your test classes lifetime
---

Last week I was writing integration tests and I wanted to reset the underlying database to a known state before each test.
[I/O-bound operations are a great use case of asynchronous tasks](https://docs.microsoft.com/en-us/dotnet/standard/async-in-depth#deeper-dive-into-tasks-for-an-io-bound-operation), so I was wondering how xUnit would help me support this.

## Lifecycle events

Every .NET test framework supports some lifecycle events.
They allow you to execute operations at different times, usually on 3 different levels.

The first one, the _test level_, is also the most fine-grained one as it lets you run code before and after every test in a class.
I tend to use this lifecycle event when I need a clean state for every test.
In this case, I would create a new instance of the <abbr title="System Under Test">SUT</abbr>.

The second level is the _class_ or _fixture level_.
Like its name implies, this gives you a chance to execute operations before the first and after the last test of a specific test class.
This is useful when you want to have all the tests of a single test class to share some common state.
While I don't use it as often as the two others, a good use case for this one would be when I test a class that doesn't hold any state, so creating new instances for each test wouldn't add any value.

The last one, I'll call the _suite level_; this one allows you to run some code before the first test and after the last test of the whole suite.
This comes in handy when you have some initialisation code that needs to run only once.
Usually, it will match what you do at the very start of your application.
I use this one to configure my AutoMapper mappings or, if I write integration tests, to run migrations on the underlying database.

## How to use lifecycle events with xUnit

xUnit supports all these options, and you can read about how to use them on [the official documentation page](https://xunit.github.io/docs/shared-context.html).

One thing you'll notice is that initialisation and cleanup mechanics fit the .NET semantics; the former is done in the constructor of the class, the latter by optionally implementing the `IDisposable` interface.

Unfortunately, at the time of writing, neither do constructors nor `IDisposable` support asynchronous, `Task`-based operations without somehow blocking the running thread.

## `IAsyncLifetime` to the rescue

Fortunately, xUnit has us covered with a special interface.
Its declaration is very simple (see [the official one](https://github.com/xunit/xunit/blob/master/src/xunit.core/IAsyncLifetime.cs)):

```csharp
public interface IAsyncLifetime
{
    Task InitializeAsync();
    Task DisposeAsync();
}
```

If either your test class, class fixture or collection fixture implement this interface, xUnit will execute the appropriate methods at the right time.
`InitializeAsync` will be called right after the constructor is invoked, and `DisposeAsync` just before `Dispose` - if it exists - is called.

## How I used it

To have each of my integration tests run on top of a known state, I wanted clean up the SQL database before each test.
To do this I used yet another open-source library created by Jimmy Bogard called [Respawn](https://github.com/jbogard/Respawn).

He decided, after porting it to .NET Standard 2.0, [to make the `Reset` method async](https://github.com/jbogard/Respawn/commit/2f08dbd309b5850acf87f263034d48d96e131752#diff-53a3924bbd9de5e0d29b2154c5f23eda).

This was the perfect opportunity to use `IAsyncLifetime`, and because <span style="text-decoration: line-through">a picture</span> some code is worth a thousand words:

```csharp
public class TestClass : IAsyncLifetime
{
    private readonly string _connectionString;
    private readonly Checkpoint _checkpoint;

    public TestClass()
    {
        _connectionString = GetItFromConfigurationFile();
        _checkpoint = new Checkpoint();
    }

    public Task InitializeAsync() => _checkpoint.Reset(_connectionString);

    [Fact]
    public async Task TestOne()
    {
        // Asynchronous operations again
    }

    [Fact]
    public async Task TestTwo()
    {
        // Asynchronous operations again
    }

    public Task DisposeAsync => Task.CompletedTask;
}
```