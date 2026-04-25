import React from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

import { View } from '@/src/tw';
import type { Coords } from '@/hooks/use-current-location';

type Props = {
  coords: Coords;
  /** Degrees per animation frame. ~0.04 ≈ one full revolution per ~2.5 minutes. */
  rotationSpeed?: number;
  /** Camera tilt in degrees from top-down. 0 = top-down, 67 ≈ a soft horizon. */
  tilt?: number;
  /** Distance from the focus point in meters. */
  range?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Photorealistic 3D Map background.
 *
 * Renders Google's Photorealistic 3D Tiles via the Maps JavaScript API
 * `<gmp-map-3d>` web component, slowly orbiting the user's location.
 *
 * The WebView allows pointer events so the user can dismiss any consent /
 * "for development purposes only" banners Google injects on first load.
 * Camera gestures are disabled inside the page itself, so panning, zooming,
 * and tilting are blocked even though touches reach the WebView.
 */
export function Map3D({
  coords,
  rotationSpeed = 0.04,
  tilt = 67,
  range = 800,
  style,
}: Props) {
  const apiKey = process.env.EXPO_PUBLIC_MAPS_KEY ?? '';
  const html = buildMapHtml({ coords, apiKey, rotationSpeed, tilt, range });

  if (Platform.OS === 'web') {
    const Iframe = 'iframe' as unknown as React.ComponentType<{
      srcDoc: string;
      style: object;
      title: string;
    }>;
    return (
      <View style={style}>
        <Iframe
          srcDoc={html}
          style={{ width: '100%', height: '100%', border: 0 }}
          title="Northstar map"
        />
      </View>
    );
  }

  return (
    <View style={style}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={{ flex: 1, backgroundColor: '#0b0e12' }}
        // Default-on: lets the user dismiss Google's consent / dev banners.
        // The map page itself disables camera gestures so taps don't pan.
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        setSupportMultipleWindows={false}
        // No bouncing / browser-y scroll feel.
        bounces={false}
        scrollEnabled={false}
      />
    </View>
  );
}

function buildMapHtml({
  coords,
  apiKey,
  rotationSpeed,
  tilt,
  range,
}: {
  coords: Coords;
  apiKey: string;
  rotationSpeed: number;
  tilt: number;
  range: number;
}) {
  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #0b0e12; overflow: hidden; }
  gmp-map-3d { width: 100vw; height: 100vh; display: block; outline: none; }

  /* Loading shimmer until the first tiles paint. */
  .loading {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    color: rgba(245, 239, 228, 0.5);
    font: 12px ui-monospace, Menlo, monospace;
    letter-spacing: 0.18em; text-transform: uppercase;
    pointer-events: none;
  }

  /* Hide the "For development purposes only" / billing-not-enabled overlay
     that Google injects when usage is unmetered. The pop-up is a fixed
     dialog appended to the body; selectors below catch its common shapes. */
  .dismissible-promotion,
  .gm-style-pbc,
  .gm-style-cc,
  div[role="dialog"]:not([data-allow]),
  .api-load-alpha-banner,
  .api-load-alpha,
  body > div[style*="z-index: 10000"]:not(:has(gmp-map-3d)) {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }
</style>
</head>
<body>
<div class="loading" id="loading">acquiring terrain…</div>

<gmp-map-3d
  id="map"
  mode="hybrid"
  center="${coords.latitude},${coords.longitude},120"
  tilt="${tilt}"
  range="${range}"
  heading="0"
  default-labels-disabled>
</gmp-map-3d>

<script>
(g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=\`https://maps.\${c}apis.com/maps/api/js?\`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({
  key: "${apiKey}",
  v: "weekly"
});

(async () => {
  try {
    await google.maps.importLibrary("maps3d");
    const map = document.getElementById('map');
    if (!map) throw new Error('map element missing');

    document.getElementById('loading').style.display = 'none';

    // Lock the camera: disable user gestures so the map stays ambient.
    // The element exposes these as boolean attributes / properties.
    try {
      map.setAttribute('default-ui-disabled', '');
    } catch (e) {}

    // Block touch/pointer events that would trigger pan/tilt/zoom, while
    // leaving room for the user to dismiss Google's overlay dialogs.
    const swallow = (e) => {
      if (e.target === map || (map.contains && map.contains(e.target))) {
        e.stopPropagation();
      }
    };
    ['wheel','touchmove','gesturestart','gesturechange','gestureend','dblclick']
      .forEach((evt) => map.addEventListener(evt, swallow, { passive: false, capture: true }));
    map.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

    // Slow ambient orbit.
    let heading = 0;
    function tick() {
      heading = (heading + ${rotationSpeed}) % 360;
      try { map.heading = heading; } catch (e) {}
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    // Kick the dismissal selector again whenever Google adds a new overlay.
    const observer = new MutationObserver(() => {
      document.querySelectorAll(
        '.dismissible-promotion, .api-load-alpha-banner, .api-load-alpha'
      ).forEach((el) => el.remove());
    });
    observer.observe(document.body, { childList: true, subtree: true });
  } catch (err) {
    document.getElementById('loading').textContent = 'map unavailable';
    console.error(err);
  }
})();
</script>
</body>
</html>`;
}
