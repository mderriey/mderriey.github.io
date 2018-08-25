---
layout: post
title: What happens when you start a VSTS agent Docker container?
description: What happens when you start a VSTS agent Docker container?
---

Here's what I learnt last week because of a copy/paste error 🤣

Did you know Microsoft provide Docker images for the VSTS agent?
The [`microsoft/vsts-agent`](https://hub.docker.com/r/microsoft/vsts-agent/) image allows you to run the VSTS agent in a Docker container.

A colleague of mine who ran out of free build minutes on VSTS was trying to start one up.
Unfortunately, he always ran into the same issue, and was presented this error message:

```
error: could not determine a matching VSTS agent - check that account '<tenant-name>' is correct and the token is valid for that account
```

Even though the error message is very explicit, we thought the token was valid since it had just been generated and started to think that maybe the environment variables we were passing in to the container were wrong.

Knowing that the repository containing the `Dockerfile`s of the images is open-source, we headed to [https://github.com/Microsoft/vsts-agent-docker](https://github.com/Microsoft/vsts-agent-docker) and searched for that error message.

We landed on a `start.sh` file where we found our error message, and tried to figure out what was the execution flow.
Here's the portion of the script we focused on:

```sh
echo Determining matching VSTS agent...
VSTS_AGENT_RESPONSE=$(curl -LsS \
  -u user:$(cat "$VSTS_TOKEN_FILE") \
  -H 'Accept:application/json;api-version=3.0-preview' \
  "https://$VSTS_ACCOUNT.visualstudio.com/_apis/distributedtask/packages/agent?platform=linux-x64")

if echo "$VSTS_AGENT_RESPONSE" | jq . >/dev/null 2>&1; then
  VSTS_AGENT_URL=$(echo "$VSTS_AGENT_RESPONSE" \
    | jq -r '.value | map([.version.major,.version.minor,.version.patch,.downloadUrl]) | sort | .[length-1] | .[3]')
fi

if [ -z "$VSTS_AGENT_URL" -o "$VSTS_AGENT_URL" == "null" ]; then
  echo 1>&2 error: could not determine a matching VSTS agent - check that account \'$VSTS_ACCOUNT\' is correct and the token is valid for that account
  exit 1
fi
```

The first block seems to be making an HTTP request with the `curl` tool.
I tried making that request against my VSTS tenant with a personal access token I just generated, and here's the response I got back:

```json
{
  "count": 9,
  "value": [
    {
      "type": "agent",
      "platform": "linux-x64",
      "createdOn": "2018-07-11T18:30:02.527Z",
      "version": {
        "major": 2,
        "minor": 136,
        "patch": 1
      },
      "downloadUrl": "https://vstsagentpackage.azureedge.net/agent/2.136.1/vsts-agent-linux-x64-2.136.1.tar.gz",
      "infoUrl": "https://go.microsoft.com/fwlink/?LinkId=798199",
      "filename": "vsts-agent-linux-x64-2.136.1.tar.gz"
    },
    {
      "type": "agent",
      "platform": "linux-x64",
      "createdOn": "2018-05-31T18:02:29.463Z",
      "version": {
        "major": 2,
        "minor": 134,
        "patch": 2
      },
      "downloadUrl": "https://vstsagentpackage.azureedge.net/agent/2.134.2/vsts-agent-linux-x64-2.134.2.tar.gz",
      "infoUrl": "https://go.microsoft.com/fwlink/?LinkId=798199",
      "filename": "vsts-agent-linux-x64-2.134.2.tar.gz"
    },
    {
      "type": "agent",
      "platform": "linux-x64",
      "createdOn": "2018-06-12T17:26:59.84Z",
      "version": {
        "major": 2,
        "minor": 134,
        "patch": 0
      },
      "downloadUrl": "https://vstsagentpackage.azureedge.net/agent/2.134.0/vsts-agent-linux-x64-2.134.0.tar.gz",
      "infoUrl": "https://go.microsoft.com/fwlink/?LinkId=798199",
      "filename": "vsts-agent-linux-x64-2.134.0.tar.gz"
    },
    {
      "type": "agent",
      "platform": "linux-x64",
      "createdOn": "2018-05-04T15:44:30.593Z",
      "version": {
        "major": 2,
        "minor": 133,
        "patch": 3
      },
      "downloadUrl": "https://vstsagentpackage.azureedge.net/agent/2.133.3/vsts-agent-linux-x64-2.133.3.tar.gz",
      "infoUrl": "https://go.microsoft.com/fwlink/?LinkId=798199",
      "filename": "vsts-agent-linux-x64-2.133.3.tar.gz"
    },
    {
      "type": "agent",
      "platform": "linux-x64",
      "createdOn": "2018-05-21T18:03:22.033Z",
      "version": {
        "major": 2,
        "minor": 133,
        "patch": 2
      },
      "downloadUrl": "https://vstsagentpackage.azureedge.net/agent/2.133.2/vsts-agent-linux-x64-2.133.2.tar.gz",
      "infoUrl": "https://go.microsoft.com/fwlink/?LinkId=798199",
      "filename": "vsts-agent-linux-x64-2.133.2.tar.gz"
    },
    {
      "type": "agent",
      "platform": "linux-x64",
      "createdOn": "2018-03-19T16:01:44.94Z",
      "version": {
        "major": 2,
        "minor": 131,
        "patch": 0
      },
      "downloadUrl": "https://vstsagentpackage.azureedge.net/agent/2.131.0/vsts-agent-linux-x64-2.131.0.tar.gz",
      "infoUrl": "https://go.microsoft.com/fwlink/?LinkId=798199",
      "filename": null
    },
    {
      "type": "agent",
      "platform": "linux-x64",
      "createdOn": "2018-02-26T16:29:08.783Z",
      "version": {
        "major": 2,
        "minor": 129,
        "patch": 1
      },
      "downloadUrl": "https://vstsagentpackage.azureedge.net/agent/2.129.1/vsts-agent-linux-x64-2.129.1.tar.gz",
      "infoUrl": "https://go.microsoft.com/fwlink/?LinkId=798199",
      "filename": null
    },
    {
      "type": "agent",
      "platform": "linux-x64",
      "createdOn": "2018-01-26T22:11:32.117Z",
      "version": {
        "major": 2,
        "minor": 127,
        "patch": 0
      },
      "downloadUrl": "https://vstsagentpackage.azureedge.net/agent/2.127.0/vsts-agent-linux-x64-2.127.0.tar.gz",
      "infoUrl": "https://go.microsoft.com/fwlink/?LinkId=798199",
      "filename": null
    },
    {
      "type": "agent",
      "platform": "linux-x64",
      "createdOn": "2017-12-05T19:38:34.7Z",
      "version": {
        "major": 2,
        "minor": 126,
        "patch": 0
      },
      "downloadUrl": "https://vstsagentpackage.azureedge.net/agent/2.126.0/vsts-agent-linux-x64-2.126.0.tar.gz",
      "infoUrl": "https://go.microsoft.com/fwlink/?LinkId=798199",
      "filename": null
    }
  ]
}
```

Interesting! The container asks VSTS which agents are available for the `linux-x64` platform.
And then it struck us: the Docker image doesn't have the VSTS agent binaries in it, which, when we think about it, makes a lot of sense.
Doing so would mean the release cycle of the agent would need to be in line with the release cycle of the Docker image, which is less than ideal.

To work around this, the Docker container, upon start, wil install the agent and run it.
But we're not there yet. Let's have a look at the second block:

```sh
if echo "$VSTS_AGENT_RESPONSE" | jq . >/dev/null 2>&1; then
  VSTS_AGENT_URL=$(echo "$VSTS_AGENT_RESPONSE" \
    | jq -r '.value | map([.version.major,.version.minor,.version.patch,.downloadUrl]) | sort | .[length-1] | .[3]')
fi
```

This is kind of Chinese to me, but knowing that the `$VSTS_AGENT_RESPONSE` variable should contain the JSON response displayed above, it seems to be running the `jq` program on it with some parameters.
A quick search away and we found from the [official website]((https://stedolan.github.io/jq/)) that `jq` is a _lightweight and flexible command-line JSON processor_.

And they have an [online playground](https://jqplay.org/), too, great, let's try it.
We filled the JSON and the filter, checked the _Raw output_ option &mdash; which we guessed is the equivalent of the `-r` parameter &mdash; and the result was `https://vstsagentpackage.azureedge.net/agent/2.136.1/vsts-agent-linux-x64-2.136.1.tar.gz`.

We analysed the query more closely and figured that it was a way to get the latest version of the agent. Neat!
Let's decompose the query:

 - `.value` expands the `value` property of the JSON object; the result of that is then an array of objects;
 - it's then piped to `map([.version.major,.version.minor,.version.patch,.downloadUrl])` which executes a projection over each object, selecting 4 properties on each of them, 3 being the version portions, the last one being the download URL; at this point, the result is an array of objects, each containing these 4 properties;
 - these objects are then being sorted; our assumption here is that they're sorted based on the order of the properties, so first by the major version, then the minor and finally the patch; the result is the same array, but it's sorted so that the first object is the _smallest_ version and the last one is the _greatest_;
 - `.[length-1]` selects the last item of the array, so effectively the one with the latest version; now the current result is an object with 4 properties;
 - finally we assumed that the last part, `.[3]`, selects the fourth property of the object, being the download URL

All this done in a single line!
The result of this query is stored in the `VSTS_AGENT_URL` variable.

On to the last block:

```sh
if [ -z "$VSTS_AGENT_URL" -o "$VSTS_AGENT_URL" == "null" ]; then
  echo 1>&2 error: could not determine a matching VSTS agent - check that account \'$VSTS_ACCOUNT\' is correct and the token is valid for that account
  exit 1
fi
```

If the `VSTS_AGENT_URL` variable doesn't exist of if it's `null`, then the error message gets displayed.
At this stage, we were scratching our heads 🤔
We followed the execution flow and it all seemed right.

We decided to double-check whether the token was correct, and guess what, it wasn't!
After generating it, it was pasted into OneNote which capitalised the first letter, which made it invalid.
It was then copied from OneNote into the `docker run` command, which explained why we saw the error.

Two things I'm taking out of this situation:

 - Check my basics &mdash; **absolute** basics &mdash; when you're encountering an issue. Is the cable disconnected? Is the token valid? Is the laptop connected to the Internet? I know I tend to assume the basics are working as expected and go head first into what I think is a non trivial problem;
 - I'm still really happy we went on this investigation because I got a better understanding of how that specific container works. And it took us maybe 30 minutes to figure out it was the token which was invalid. So another thing I'll remind myself is to timebox these deep-dives so I don't spend too much time when the fix is simple.

