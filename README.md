# Capsule Ferrofluid Study

This demo is a first pass toward your headphone-capsule concept:
- soft ferrofluid blob floating in oil
- static driver magnet attraction point
- no spike formation, just jostling and pulsing motion

## Files
- `index.html` - canvas + control panel
- `styles.css` - visual styling and UI
- `main.js` - particle simulation + metaball rendering + capsule shading

## Run locally
From `/Users/ryanachenbach/Documents/New project`:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Current controls
- `Magnet strength` - pull toward the static magnet
- `Gravity` - downward pull inside the capsule
- `Organic jitter` - alive-looking motion
- `Render quality` - controls field resolution/performance balance
- `Pulse rate (Hz)` - how often the magnet turns on
- `Pulse aggression` - harder on/off bursts for stronger throbbing motion
- `Density` - changes how strongly particles cluster together
- `Viscosity` - controls internal liquid damping between neighboring particles
- `Resistance` - global drag from the surrounding medium (higher = heavier/slower motion)
- `Point light color` - sets point-light hue for highlights and glow
- `Point light intensity` - scales point-light illumination strength
- `Point light X/Y` - repositions the light relative to the capsule
- `Audio reactive drive` - uses real audio input to control magnet behavior
- `Driver behavior` - choose `Magnet on/off` or `Magnet in/out`
- `Music file` / `Play file` - load and play a track for reactive motion
- `Use mic` - drive the fluid from live microphone input
- `Audio sensitivity` - amplifies audio influence on pulse strength
- `Audio smoothing` - stabilizes or loosens the audio envelope
- `Audio threshold` - minimum audio level before pulses engage
- `Manual pulse mode (mouse)` - disables auto pulse and lets click/hold drive the pulse
- `Show speaker` - toggles visibility of the speaker/driver marker
- `Mouse wheel` - zoom camera in/out
