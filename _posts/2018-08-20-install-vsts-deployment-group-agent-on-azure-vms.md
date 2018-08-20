---
layout: post
title: How to install VSTS deployment group agents on Azure VMs
description: How to install VSTS deployment group agents on Azure VMs
---

I recently got to work on an Azure migration project where we took the _lift & shift_ approach as a first step.
This means that the solution, while running in Azure, was still making use of virtual machines.

We decided to create two separate release pipelines:

 - the one that would provision the infrastructure in Azure &mdash; this one would be run only once for each environment as we don't plan on tearing down/bringing up the resources for each application deployment; and
 - the application deployment one, which would update the applications bits on the virtual machines created in the first step &mdash; this one would be run much more frequently

The second one, that deploys the applications to the virtual machines, runs from a cloud-hosted agent provided by VSTS and uses WinRM to connect to the VMs to perform all the necessary steps, like copy scripts and packages over, configure IIS, deploy the packages, etc...

When I presented that solution to a few colleagues, one of them asked:

> Why didn't you install VSTS agents on the VMs? It's more secure since it uses a pull model (instead of a push one), meaning you wouldn't need to punch holes in the firewall for the cloud agent to connect to the virtual machines.

They have a very good point!
I might add that another benefit of running the release directly from the VMs would likely speed up the process, as the artifacts would be downloaded automatically on the VM at the start of the release, and each and every step in the release wouldn't need to set up a WinRM connection to the VM.

So I started looking for a way to do exactly this.
We are using the built-in [Azure Resource Group Deployment task](https://docs.microsoft.com/en-us/vsts/pipelines/tasks/deploy/azure-resource-group-deployment?view=vsts), and one of the [arguments](https://docs.microsoft.com/en-us/vsts/pipelines/tasks/deploy/azure-resource-group-deployment?view=vsts#arguments) called _Enable Prerequisites_ allows to install the VSTS deployment group agent on all the VMs declared in your ARM template.

#### What's this deployment group agent?

VSTS introduced some time ago the concept of deployment group, which is a bunch of target machines that all have an agent installed and can be assigned tags.
I find it's similar to the way Octopus Deploy works.
When using deployment groups, the release pipeline is made of deployment group phases, where each phase runs on servers with specific tags.
This means you could execute different tasks on your database servers and on your web servers, or you could decide to split them based on which application they run.
If you're more interested in this, I suggest you read the [official documentation](https://docs.microsoft.com/en-us/vsts/pipelines/release/deployment-groups/?view=vsts).

Going back to the VSTS task, here's the property that allows you to install the agent on the virtual machines:

<figure>
  <img src="/public/images/posts/2018-08-20/enable-prerequisites.png" alt="Install the VSTS deployment group agent on VMs">
  <figcaption>The setting that drives the installation of the deployment group agent on VMs</figcaption>
</figure>

After selecting that option, we're prompted to fill in a few additional properties:

 - a VSTS service endpoint;
 - a team project within the previously selected VSTS instance;
 - a deployment group that belongs to the selected team project;
 - whether we want to copy the tags from each VM to the associated agent; and finally
 - whether we want to run the VSTS agent service as a different user than the default one

<figure>
  <img src="/public/images/posts/2018-08-20/settings-of-dg-agent.png" alt="Settings required to install the deployment group agent on VMs">
  <figcaption>The settings required to install the deployment group agent</figcaption>
</figure>

This all worked out as expected, and going back to my deployment group after the privisionning of the VMs, I could see as many agents as VMs that were created.
The next task was to modify the application deployment pipeline to adapt it to the fact that the process would now run directly on the virtual machines, and remove the rules that allowed inbound traffic for WinRM.
It's also worth noting that the process now needs to contain _deployment group phases_ as opposed to _agent phases_.

Using this approach has several benefits:

 - increased security, as no inbound traffic is required to the VMs;
 - a quicker release process as there's no need for WinRM connections for each step;
 - it also handles potential changes in the infrastructure: if we decide to increase the number of VMs for an application for increased reliability, the fact that the application deployment pipeline is based on VM tags means this will be transparent

#### Going deeper

While the main goal was achieved, I had a few questions in my mind:

 - how does the VSTS task install the VSTS agent on all the VMs?
 - why does the task require a VSTS service endpoint if the agent is to be connected to the same VSTS instance as the one where the release runs?

As all the VSTS tasks are open-source &mdash; if you didn't know, you can find the source code in the [`Microsoft/vsts-tasks`](https://github.com/Microsoft/vsts-tasks) repository on GitHub &mdash; I decided to take a look under the hood.

The code for the _Azure Resource Group Deployment_ task is in the [`Tasks/AzureResourceGroupDeploymentV2`](https://github.com/Microsoft/vsts-tasks/tree/master/Tasks/AzureResourceGroupDeploymentV2) folder.

The [`task.json`](https://github.com/Microsoft/vsts-tasks/blob/d00a7083f5e4effd7c1ee6c50b25273ca26b9104/Tasks/AzureResourceGroupDeploymentV2/task.json) file contains metadata about the task, like its name, the different input properties &mdash; and the rules around conditional visibility, like _show setting B only when setting A has this value_ &mdash; and the execution entry point to invoke when the task need to run.

After finding the [_Enable prerequisites_ property](https://github.com/Microsoft/vsts-tasks/blob/d00a7083f5e4effd7c1ee6c50b25273ca26b9104/Tasks/AzureResourceGroupDeploymentV2/task.json#L179-L190), I traced the execution flow of the task until I landed on the [`DeploymentGroupExtensionHelper.ts`](https://github.com/Microsoft/vsts-tasks/blob/d00a7083f5e4effd7c1ee6c50b25273ca26b9104/Tasks/AzureResourceGroupDeploymentV2/operations/DeploymentGroupExtensionHelper.ts) which handles all things related to the installation of the deployment group agent on VMs.

And surprise! The VSTS task delegates the installation to the `TeamServicesAgent` Azure VM extension, as these [`two functions`](https://github.com/Microsoft/vsts-tasks/blob/d00a7083f5e4effd7c1ee6c50b25273ca26b9104/Tasks/AzureResourceGroupDeploymentV2/operations/DeploymentGroupExtensionHelper.ts#L149-L235) show. This answers the second question I had: the VSTS task needs a VSTS service endpoint to generate a PAT to register the agent as the underlying Azure VM extension rquires one.

The good thing about the fact that the agent installation is handled with an Azure VM extension is that we can easily reduce the coupling to this task by deploying the extension ourselves in the ARM template. This means that if we decide to move away from the VSTS task and do the deployment with either PowerShell scripts or the Azure CLI, we won't be _losing_ anything.