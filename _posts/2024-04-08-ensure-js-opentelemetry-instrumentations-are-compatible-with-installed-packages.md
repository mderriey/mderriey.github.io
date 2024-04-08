---
layout: post
title: Ensure Node.js OpenTelemetry instrumentations are compatible with installed packages
description: In this post we look at a way to make sure you never lose telemetry in your app without knowing it.
---

# Introduction

Telemetry is a core aspect of monitoring and observability; it helps making sure systems run smoothly, troubleshooting issues after the fact, or being alerted when things go pear-shaped.

Losing telemetry seriously hinders those capabilities and it is what happened to me on my most recent project.
I was lucky enough to discover it soon after it happened, completely by accident!

In this post, we'll go through how OpenTelemetry instrumentation works in Node.js, how we lost critical telemetry in our project, and how we made sure it won't happen again.

## OpenTelemetry instrumentation in Node.js

If you're new to OpenTelemetry, here's an excerpt from the [official documentation](https://opentelemetry.io/docs/what-is-opentelemetry/):

> OpenTelemetry is an Observability framework and toolkit designed to create and manage telemetry data such as traces, metrics, and logs.

Instrumentation is the act of adding observability code to an application.
When you develop an app, you might use third-party libraries and frameworks to accelerate your work.
If you then instrument your app using OpenTelemetry, you might want to avoid spending additional time to manually add traces, logs, and metrics to the third-party libraries and frameworks you use. ([source](https://opentelemetry.io/docs/languages/js/libraries/)).

Most applications use third-party libraries for the building blocks of an application, like the HTTP server, making database queries, issuing outgoing HTTP requests, etc and in my experience, most of these libraries don't have native support for OpenTelemetry, so we rely on specific instrumentation libraries that patch the instrumented libraries at runtime to emit telemetry when certain events occur.

## How we lost telemetry in our project

We updated npm packages 😇.

Because instrumented libraries are patched at runtime by instrumentation libraries, there needs to be some contract between the two to ensure that the functionality of instrumented libraries is not affected. This is typically done with instrumentation libraries declaring a supported version range for the package they instrument.

Our project is a Node.js app that integrates with a SQL Server database using the [mssql npm package](https://www.npmjs.com/package/mssql), which uses [tedious](https://www.npmjs.com/package/tedious) as a low-level TDS implementation.
In order to get telemetry around our database queries, we installed the [@opentelemetry/instrumentation-tedious instrumentation package](https://www.npmjs.com/package/@opentelemetry/instrumentation-tedious).

All was fine until we decided to update the npm packages; a new major version of mssql had been released, itself bringing a new version of tedious.
The release notes didn't mention breaking changes, and it all seemed to work fine during testing.

I later realised, by accident, that our database queries were not instrumented anymore.
What happened is that the new version of tedious we installed, v16, was outside of the supported version range of the associated instrumentation package, which at the time of writing only supports versions [up to v15](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node/instrumentation-tedious#supported-versions).

## How we fixed the situation

We found [a report](https://github.com/open-telemetry/opentelemetry-js-contrib/pull/1638) indicating that the instrumentation is compatible with tedious v16, so we patched the instrumentation with patch-package to amend the supported version range.

The next step was to ensure we would be notified the next time we find ourselves in this situation.
Unfortunately, the OpenTelemetry SDK doesn't emit specific events or log entries when an instrumentation is found to not be compatible with the instrumented package, so we came up with a test that leverages the instrumentations `init` function that includes the name of the package they instrument, and the version range they support.

```typescript
import type { InstrumentationNodeModuleDefinition } from '@opentelemetry/instrumentation/build/src/instrumentationNodeModuleDefinition'
import path from 'node:path'
import semver from 'semver'
import fs from 'node:fs'
import { instrumentations } from './instrumentations'
import os from 'node:os'
import { groupBy } from 'lodash'

describe('OpenTelemetry instrumentations', () => {
  it(`are compatible with the installed version of the packages they instrument`, () => {
    const applicableInstrumentationDefinitions = instrumentations
      // They can expose several module definitions; redis does: one for @redis/client, one for @node-redis/client
      .flatMap((x) => (x as any).init() as InstrumentationNodeModuleDefinition<unknown> | InstrumentationNodeModuleDefinition<unknown>[])
      // Only get the ones that apply to us
      .filter(({ name }) => fs.existsSync(getPackageNodeModulesDirectory(name)))

    const groupedByPackageName = groupBy(applicableInstrumentationDefinitions, (x) => x.name)
    const results = Object.entries(groupedByPackageName).map(([packageName, instrumentationDefinitions]) => {
      const installedVersion = getPackageVersion(packageName)
      const incompatibleInstrumentationDefinitions = instrumentationDefinitions.filter(({ supportedVersions }) => {
        // http and https instrumentations have a '*' version range, so we special case it
        // because we can't get versions for these built-in modules
        if (supportedVersions.includes('*')) {
          return false
        }

        return supportedVersions.every((x) => !semver.satisfies(installedVersion, x))
      })

      // If none of the definitions for a package are applicable, then we have an issue
      return incompatibleInstrumentationDefinitions.length !== instrumentationDefinitions.length
        ? ({ result: 'success' } as const)
        : ({
            result: 'failure',
            packageName,
            packageVersion: installedVersion,
            supportedVersions: incompatibleInstrumentationDefinitions.flatMap((x) => x.supportedVersions),
          } as const)
    })

    const failures = results.filter((x): x is typeof x & { result: 'failure' } => x.result === 'failure')
    if (failures.length > 0) {
      throw new Error(`Some instrumentations are not compatible with the version of the installed packages:
${failures
  .map(
    ({ packageName, packageVersion, supportedVersions }) =>
      `- ${packageName}@${packageVersion}, supported versions are ${supportedVersions.join(', ')}`,
  )
  .join(os.EOL)}`)
    }
  })
})

function getPackageVersion(packageName: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(getPackageNodeModulesDirectory(packageName), 'package.json')).version
}

function getPackageNodeModulesDirectory(packageName: string): string {
  return path.join(process.cwd(), 'node_modules', packageName)
}
```

A few notes about this:

1. This assumes that the instrumentations you're configuring in your application are defined in a separate file.
1. Instrumentations can define several instrumentation definitions, like the Redis instrumentation [exposes definitions for different modules](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/edc426b348bc5f45ff6816bcd5ea7473251a05df/plugins/node/opentelemetry-instrumentation-redis-4/src/instrumentation.ts#L66-L74), so we only select the ones that apply to us; the current naive check is to verify whether a matching directory exists under `node_modules`.
1. The winston instrumentation exposes [different definitions for different version ranges](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/edc426b348bc5f45ff6816bcd5ea7473251a05df/plugins/node/opentelemetry-instrumentation-winston/src/instrumentation.ts#L40-L106), so we group the definitions by package name, and consider an instrumentation incompatible if none of the definitions satisfy the currently installed package version.
1. Finally, the [HTTP instrumentation](https://github.com/open-telemetry/opentelemetry-js/blob/3920b158d08daa776280bde68a79e44bafa4e8ea/experimental/packages/opentelemetry-instrumentation-http/src/http.ts#L117) and [HTTPS instrumentation](https://github.com/open-telemetry/opentelemetry-js/blob/3920b158d08daa776280bde68a79e44bafa4e8ea/experimental/packages/opentelemetry-instrumentation-http/src/http.ts#L161) use `*` as the supported version range; given these are built-in modules, we can't get their installed version, so we special-case `*` to return early.

We may very well run into different edge cases that we will need to handle, and I'm hopeful that when this happens the test will fail with a runtime error rather than pass silently.

## Conclusion

In this post, we first saw what OpenTelemetry is and how instrumentation works in Node.js.
Instrumentation libraries are so very helpful, and help you get set up with telemetry in no time.

We then discussed how instrumentations define version ranges for the package they instrument to ensure compatibility.
It's a great concept, but in our case it means we lost instrumentation for database queries without realising it.

Finally, we went over how we fixed the issue, and the remediation step we took to minimise the risk of it happening again in the future with a test that compares the instrumentations supported version range with the versions of the packages we have installed in our project.
