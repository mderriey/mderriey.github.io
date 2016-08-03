---
layout: post
title: Properties attributes in Polymer
---

I feel like there's a misunderstanding about some of the attributes that we can apply to properties in Polymer. Let's go through them.

##### reflectToAttribute
This is to me the most misused attribute.
I haven't been doing Polymer for very long, and I got this one completely wrong at first.
I thought that in order to have a property bindable, we had to throw this attribute on it. This is wrong, as every property we declare is by default bindable, *except* of course for the ones having the `readOnly` or `computed` attribute.

What the `reflectToAttribute` does is instruct Polymer that it has to serialise the property's value to an HTML attribute on the actual HTML element representing our component.

Let's say we have the following element declaration:

```javascript
Polymer({
    is: 'my-element',
    properties: {
        tasks: {
            type: Array,
            reflectToAttribute: true
        }
    }
});
```

 and we bind an array to that property. This is what the DOM could look like:

```html
<my-element tasks="[{"id":1,"name":"foo"},{"id":2,"name":"bar"}]"></my-element>
```

This is bad because we may not want to expose all that data directly in the DOM. Plus, there must be some performance overhead associated with the serialisation of the value every time it changes.


*When to use it, then?*
**Great** question!
So far, I've only seen one case where it's useful to use it, and that is CSS styling.
Given the property and its value will be represented as an HTML attribute, we can then have specific CSS rules depending on:

 + the existence of the attribute
 + the value of the attribute

A good example is the `paper-button` and its `raised` property.
We can see on the [declaration of the raised property](https://github.com/PolymerElements/paper-button/blob/08553a8c5e4d27fc6180bbcfb952f86b38b51345/paper-button.html#L147) that it has the `reflectToAttribute` set to `true`.
In the associated styles, [here](https://github.com/PolymerElements/paper-button/blob/08553a8c5e4d27fc6180bbcfb952f86b38b51345/paper-button.html#L104) and [there](https://github.com/PolymerElements/paper-button/blob/08553a8c5e4d27fc6180bbcfb952f86b38b51345/paper-button.html#L109), we have specific style rules are applied if the element has the `raised` attribute.
> `Boolean` properties are special because the way Polymer treats them is the following: the attribute will exist only if the value is `true`, and it will have no value - like the common `checked` and `disabled` attributes on `input` - otherwise it won't be present.

So most of the time, we won't need that attribute, so I think a good practice - and this applies to the following attribute, too - is not to throw it automatically on every property.

##### notify
This attribute is often applied to properties without an analysis of whether it's really needed or not. It has to do with child-to-host binding.

> It is useful **only** if we want a parent element to be notified that the property of your component changed, and by the same time update the property of the parent element to which it is bound. I hope that makes sense.

Let's see an example:

```html
<dom-module id="my-child-element">
    <template>
    </template>
    <script>
        Polymer({
            is: 'my-child-element',
            properties: {
                notifier: {
                    type: String,
                    notify: true
                }
            }
        });
    </script>
</dom-module>

<dom-module id="my-parent-element">
    <template>
        <my-child-element notifier="{{notified}}">
        </my-child-element>
    </template>
    <script>
        Polymer({
            is: 'my-parent-element',
            properties: {
                notified: String
            }
        });
    </script>
</dom-module>
```

In this case it makes sense to have `notify: true` on the `notify` property because we want the `notified` property of the parent element to be automatically updated when `notifier` changes. What we have here is a child-to-host data flow. Also notice the use of curly braces in the binding, which are necessary to have the parent element's property updated automatically.

Let's now imagine we only want to propagate the value from the host to the child, that is to the parent to the child element. We can modify our code:

```html
<dom-module id="my-child-element">
    <template>
    </template>
    <script>
        Polymer({
            is: 'my-child-element',
            properties: {
                destination: String
            }
        });
    </script>
</dom-module>

<dom-module id="my-parent-element">
    <template>
        <my-child-element destination="[[source]]">
        </my-child-element>
    </template>
    <script>
        Polymer({
            is: 'my-parent-element',
            properties: {
                source: String
            }
        });
    </script>
</dom-module>
```

The names of the properties were changed so that they still make sense. We now face a host-to-child data flow. Because the `destination` property doesn't have the `notify` attribute, it doesn't make sense to use curly braces anymore, so we swapped them for square ones.

>It's not always easy to figure out if a property will have to let know a parent element that its value has changed, especially when we deal with global components that are used all over the code base. But for some higher level components, let's say at the page level, it's easier to figure out the scope of the properties and apply the `notify` attribute correctly.

##### readOnly
I personally like this attribute and I think I don't use it as often as I could. Applying it to a property prevents that property from being changed via direct assignment or data-binding. Polymer creates under the hood a *private* function that allows the change its value. I say *private* (you should see air quotes, here) because the function is not really private, in the sense that another component could call it.

See this example:

```javascript
Polymer({
    is: 'my-element',
    properties: {
        internalState: {
            type: String,
            readOnly: true
        }
    }
});
```

As stated earlier, the `internalState` property could not be modified with binding or direct assignment, but Polymer created for us a `_setInternalState` function that allows us to change the value of the property. Still, another component could invoke this function, but we know we're badass when we invoke a function starting with an underscore, right?

> This attribute allows us to implicitly state that the value of this property is the sole responsibility of the component it's defined in. But this property could be used by a parent component!

A great example comes from Polymer itself in the `iron-media-query` element. It has 2 properties:

 + The `query` property in which we pass the media query we target
 + The `queryMatches` property, which value is a `Boolean` taht indicates if the media query is matched or not

Now, it's the responsibility of the `iron-media-query` element to determine if the media query is matched or not, and it doesn't want us to trick it, so the [`queryMatches`](https://github.com/PolymerElements/iron-media-query/blob/a9dd58cd50bb9f203a7beef15282bf74e48563a8/iron-media-query.html#L38) property is defined with the `readOnly` attribute.

```html
<dom-module id="my-element">
    <template>
       <iron-media-query query="(max-width: 768px)" query-matches="{{isSmartphone}}"></iron-media-query>
    </template>
    <script>
        Polymer({
            is: 'my-element',
            properties: {
                isSmartphone: Boolean
            }
        });
    </script>
</dom-module>
```

We give the element an input from which it computes some value and returns it back to us, all of that with automatic binding. Easier would be hard to achieve.

---

#####A small words about braces
This is not actually about properties attributes, but I feel like it fits well with the general message of the post.

> My rule of thumb is the following: always use square braces if I don't expect a child-to-host data flow.

This applies to more places than you'd think:

```html
<template is="dom-if" if="[[applyLogic(myProperty)]]">
</template>

<template is="dom-repeat" items="[[myItems]]">
</template>

<span>[[myLabel]]</span>
```

There is no way we'll get data back in these cases, so why not make it even more obvious by using square braces?
I don't know if there's actually a performance penalty when using curly braces, but let's play it safe, and the visual cue of the square braces is a good enough reason for me.
