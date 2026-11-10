# watershed-lookup

Type a country and a postal code. Get back the watershed you live in, the ecoregion
around it, a link to learn whose land it is, and a view of the place from orbit.

It answers the question at the end of [The Symbiocene](https://www.john-ellison.com/symbiocene):
*what is your watershed called, and who were its first stewards?*

This repository ships **code and attribution, not data**. You download every dataset
from its official source yourself, build a private index, and query it. That is a
license requirement, not a style choice (see [License constraints](#license-constraints)).

## What a lookup returns

| Card | How | Source |
|---|---|---|
| Place | Postal code to coordinates, offline. Falls back to Nominatim (1 request per second, cached) | GeoNames postal codes, OpenStreetMap Nominatim |
| Watershed | Named major basin and the sea it drains to; island and coastal fallbacks ("Bali is its own island watershed system"); local sub-basin (level 8, about 300 to 1,600 km²) and wider basin (level 5) with area and upstream area | GRDC Major River Basins, HydroBASINS v1c, Natural Earth land and islands |
| Nearest named water | Live OpenStreetMap waterways near the point, with an offline fallback to GRDC's named main rivers | Overpass API, GRDC |
| Ecoregion and biome | Point in polygon | RESOLVE Ecoregions 2017 |
| First stewards | A link to Native Land Digital's own map, centered on the place. **No Native Land data is fetched, stored or redistributed** | native-land.ca |
| Earth imagery | A 768 px mosaic of zoom-12 tiles centered on the point, fetched server-side | EOX Sentinel-2 cloudless 2016 |

Example (Barichara, Colombia, `684041`): Magdalena basin, draining to the Caribbean Sea;
local sub-basin about 590 km² gathering water from 10,284 km² upstream; Magdalena Valley
montane forests (Tropical and Subtropical Moist Broadleaf Forests, Neotropic realm).

## Build the index yourself

Needs Node 20+ and the system `unzip` (macOS and most Linux images have it). No GIS tools.

```bash
npm install
node scripts/fetch-data.mjs                 # about 600 MB of downloads into .data/raw
npm run build-index                         # about 15 seconds; writes .data/index
npm run build && node dist/examples/server.js
curl 'http://localhost:8787/api/watershed?country=DE&postal=10115'
```

Running `fetch-data` means you accept each dataset's license yourself (listed below).
The build simplifies polygons (Douglas-Peucker at 0.004 degrees, about 400 m), quantizes
them to a 1 arc-second grid, and writes one compact file per layer:

| File | Features | Size |
|---|---|---|
| `hybas08.wsl` (HydroBASINS level 8, all nine regions merged) | 190,675 | 48 MB |
| `hybas05.wsl` | 4,734 | 8 MB |
| `resolve.wsl` | 847 | 6 MB |
| `grdc.wsl` (major basins) | 520 | 2 MB |
| `land.wsl`, `islands.wsl`, `rivers.wsl` | | 3 MB together |
| `postal/XX.json.gz` (124 countries, 1.08 million codes) | | 10.5 MB |

About 78 MB in total. That fits inside a single serverless function (Vercel's limit is
250 MB uncompressed), so there is no tile server and no database. A cold start reads a
layer in about 15 ms; a full lookup takes 5 to 15 ms of CPU.

### The `.wsl` format

A small read-only point-in-polygon index (`scripts/lib/layerfile.mjs` writes it,
`src/layer.ts` reads it): a JSON header, numeric attribute columns, quantized bounding
boxes, a uniform-grid spatial index, and varint delta-encoded rings. Point queries use
the even-odd rule, so holes work, and fall back to the nearest polygon within a few
kilometers for points that land in a simplification gap or just offshore.

## Use the library

```ts
// npm install github:johnellison/watershed-lookup
import { createLookup, renderMosaic, attributions } from 'watershed-lookup';

const lookup = createLookup({
  loadLayer: (name) => readFileSync(`.data/index/${name}.wsl`),
  loadPostal: (cc) => /* parse .data/index/postal/${cc}.json.gz, or null */,
  userAgent: 'my-watershed-tool/1.0 (+https://example.org/contact)',
  waterways: true, // set false to skip the slow live Overpass call and fetch it separately
});

const result = await lookup('ID', '80571');
// result.watershed.summary === 'Bali is its own island watershed system: its rivers run straight to the sea.'
```

`examples/server.ts` is a complete HTTP API with per-IP rate limiting.

Be a good neighbor to the free services:

- **Nominatim**: only used when GeoNames has no match. One request per second per
  process, a descriptive User-Agent, results cached
  ([policy](https://operations.osmfoundation.org/policies/nominatim/)).
- **Overpass**: public servers are slow and often down (in November 2026 a query took
  10 to 20 seconds when it answered at all, and overpass-api.de says it is meant for
  human-operated tools). Call it off the critical path, cache the result, and run your own
  instance for real traffic (pass `endpoints`).
- **EOX tiles**: fetch server-side and cache the finished mosaic for a long time, so EOX
  sees each place about once. Do not hotlink tiles from every visitor's browser.

## License constraints

The code here is Apache-2.0. The data is not, and three terms shape the design:

1. **HydroSHEDS v1** (HydroBASINS, and through it GRDC's basins) may be distributed
   only "incorporated into any Derivative Works", and "in no event shall Licensee license
   or distribute the Licensed Materials as a stand-alone product." So this repository
   contains no polygons, and your built index should stay private: bundled into your
   server or behind private storage, queried, never offered as a download or public
   static file. This is a reading of the license, not legal advice. HydroSHEDS v2 is
   CC BY 4.0, but its HydroBASINS is a beta covering the Americas only; when it goes
   global this constraint goes away.
2. **Native Land Digital**'s API terms limit commercial use and forbid storing or
   distributing API data without permission. This tool does not call their API. It links
   to their map at the place (`https://native-land.ca/maps/native-land?bbox=[[w,s],[e,n]]&center=lon,lat`).
   If you want territory names inside your own tool, ask them first: tech@native-land.ca.
3. **EOX Sentinel-2 cloudless**: only the 2016 and 2017 layers are CC BY 4.0. The 2018
   and later layers are CC BY-NC-SA 4.0 and need a commercial license from EOX for
   commercial use. This tool uses the 2016 layer.

## Attribution

Show these wherever results are shown. `attributions(productName)` returns them all,
with the HydroSHEDS statement filled in.

- **HydroBASINS / HydroSHEDS** (required statement, Exhibit B of the HydroSHEDS v1
  license): "This product [name] incorporates data from the HydroSHEDS version 1 database
  which is © World Wildlife Fund, Inc. (2006-2022) and has been used herein under license.
  WWF has not evaluated the data as altered and incorporated within [name], and therefore
  gives no warranty regarding its accuracy, completeness, currency or suitability for any
  particular purpose. Portions of the HydroSHEDS v1 database incorporate data which are
  the intellectual property rights of © USGS (2006-2008), NASA (2000-2005), ESRI
  (1992-1998), CIAT (2004-2006), UNEP-WCMC (1993), WWF (2004), Commonwealth of Australia
  (2007), and Her Royal Majesty and the British Crown and are used under license. The
  HydroSHEDS v1 database and more information are available at https://www.hydrosheds.org."
  Citations: Lehner, B., Verdin, K., Jarvis, A. (2008): New global hydrography derived
  from spaceborne elevation data. Eos, Transactions, AGU, 89(10): 93-94. Lehner, B.,
  Grill, G. (2013): Hydrological Processes, 27(15): 2171-2186,
  https://doi.org/10.1002/hyp.9740.
- **GRDC Major River Basins**: "GRDC (2020): GRDC Major River Basins. Global Runoff
  Data Centre. 2nd, rev. ed. Koblenz: Federal Institute of Hydrology (BfG)." plus the
  HydroSHEDS statement above. Public use under the condition of full citation.
- **RESOLVE Ecoregions 2017**, CC BY 4.0: "Ecoregions 2017 © Resolve. Dinerstein et al.
  (2017), An Ecoregion-Based Approach to Protecting Half the Terrestrial Realm,
  BioScience 67(6): 534-545, https://doi.org/10.1093/biosci/bix014."
- **GeoNames postal codes**, CC BY 4.0: "Postal code data © GeoNames (www.geonames.org)."
  UK codes carry Royal Mail copyright; GeoNames stores only part of the code for GB, CA,
  NL, IE, MT, AR, CL and BR, so those lookups describe the wider postal district.
- **OpenStreetMap** (Nominatim fallback, waterway names), ODbL: "© OpenStreetMap contributors."
- **EOX Sentinel-2 cloudless 2016**, CC BY 4.0: "Sentinel-2 cloudless 2016 by EOX IT
  Services GmbH (contains modified Copernicus Sentinel data 2016)", with a link to
  https://s2maps.eu. Fallback imagery: NASA GIBS Blue Marble, with the GIBS acknowledgment.
- **Natural Earth** (land and island names), public domain.
- **Native Land Digital**: linked, not used as data. "Map data provided by Native Land
  Digital (https://native-land.ca/)" applies if you ever display their data.

## Caveats to show with every result

> Postal codes cover an area, so results describe the neighborhood, not an address.
> Basin and ecoregion boundaries are modeled and simplified. Waterway names come from
> OpenStreetMap volunteers and often leave out Indigenous and local names. Native Land
> Digital says its map "does not represent or intend to represent official or legal
> boundaries of any Indigenous nations." It is a place to begin listening, not an
> authority. Contact the nations themselves to learn how they name their lands and what
> they ask of visitors.

For first stewards: *Territories shown on Native Land's map are a starting point. Ask the
nations themselves.*

When a sub-basin has no name in open data: *We could not find a name for this sub-basin in
open data. It is catalogued as HydroBASINS level 8 ID [id], about [area] km². People who
live here almost certainly have a name for it.*

## Known gaps

- HydroBASINS v1 leaves out some remote islands (Hawaii among them); the watershed card
  says so instead of guessing. The ecoregion still works there.
- GRDC's 520 major basins miss small island and coastal systems. The tool falls back to
  "its own island watershed system" (landmasses under 2.5 million km²) or "a coastal basin".
- Sub-basins have IDs, not names. A v2 could precompute names offline by joining OSM
  waterway relations to HydroRIVERS, removing the live Overpass dependency.

## Tests

`npm test` runs a synthetic round trip of the layer format, postal matching, mosaic
planning and the Native Land link. No downloads needed.
