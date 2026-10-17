---
title: The chart
draft: false
confirm: []
---

The chart is drawn in your browser, on a canvas, from one data file this site serves.

On a wide screen the narrows are scaled so the shores and buoys sit beside the text and open water lies under it. Scrolling pans the chart south toward Crown Point at about a third of the scroll speed.

Over the water beside the text, the pointer works as a depth sounder and reads the charted depth. On a phone, press and hold on the water. A click or tap on open water sends a wave at the shallow-water speed, c&nbsp;=&nbsp;√(g·h), so the crests slow over the shoals, bend around the points, and stop at the shore. Time is sped up, but the relative speeds are real.

Nothing is drawn while nothing moves. Animation stops in a hidden tab, and with reduced motion the chart is a single still frame.

Each background in the picker has a smoke test that runs it in Node with a stubbed canvas and DOM. It checks for exceptions, loops that never go idle, work in hidden tabs, and listeners or timers left behind.
