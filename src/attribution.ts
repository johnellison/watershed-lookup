// Every dataset the lookup touches, with the attribution its license requires.
// Show these wherever results are shown.

export interface Attribution {
  id: string;
  dataset: string;
  license: string;
  text: string;
  url: string;
}

export function hydroShedsStatement(productName: string): string {
  return (
    `This product, ${productName}, incorporates data from the HydroSHEDS version 1 database which is © World Wildlife Fund, Inc. (2006-2022) and has been used herein under license. ` +
    `WWF has not evaluated the data as altered and incorporated within ${productName}, and therefore gives no warranty regarding its accuracy, completeness, currency or suitability for any particular purpose. ` +
    'Portions of the HydroSHEDS v1 database incorporate data which are the intellectual property rights of © USGS (2006-2008), NASA (2000-2005), ESRI (1992-1998), CIAT (2004-2006), UNEP-WCMC (1993), WWF (2004), Commonwealth of Australia (2007), and Her Royal Majesty and the British Crown and are used under license. ' +
    'The HydroSHEDS v1 database and more information are available at https://www.hydrosheds.org.'
  );
}

export function attributions(productName: string): Attribution[] {
  return [
    {
      id: 'hydrobasins',
      dataset: 'HydroBASINS v1c (levels 5 and 8)',
      license: 'HydroSHEDS v1 License Agreement',
      text:
        hydroShedsStatement(productName) +
        ' Lehner, B., Verdin, K., Jarvis, A. (2008): New global hydrography derived from spaceborne elevation data. Eos, Transactions, AGU, 89(10): 93-94. ' +
        'Lehner, B., Grill G. (2013): Global river hydrography and network routing: baseline data and new approaches to study the world’s large river systems. Hydrological Processes, 27(15): 2171-2186. https://doi.org/10.1002/hyp.9740',
      url: 'https://www.hydrosheds.org/products/hydrobasins',
    },
    {
      id: 'grdc',
      dataset: 'GRDC Major River Basins of the World',
      license: 'Public use with full citation and reference to incorporated HydroSHEDS data',
      text: 'GRDC (2020): GRDC Major River Basins. Global Runoff Data Centre. 2nd, rev. ed. Koblenz: Federal Institute of Hydrology (BfG). Incorporates HydroSHEDS data (statement above).',
      url: 'https://grdc.bafg.de/products/basin_layers/major_rivers/',
    },
    {
      id: 'resolve',
      dataset: 'RESOLVE Ecoregions 2017',
      license: 'CC BY 4.0',
      text: 'Ecoregions 2017 © Resolve, CC BY 4.0. Dinerstein et al. (2017), An Ecoregion-Based Approach to Protecting Half the Terrestrial Realm, BioScience 67(6): 534-545. https://doi.org/10.1093/biosci/bix014',
      url: 'https://ecoregions.appspot.com/',
    },
    {
      id: 'geonames',
      dataset: 'GeoNames postal codes',
      license: 'CC BY 4.0',
      text: 'Postal code data © GeoNames (www.geonames.org), CC BY 4.0.',
      url: 'https://www.geonames.org/',
    },
    {
      id: 'osm',
      dataset: 'OpenStreetMap (waterway names; fallback geocoding via Nominatim)',
      license: 'ODbL 1.0',
      text: '© OpenStreetMap contributors, ODbL.',
      url: 'https://www.openstreetmap.org/copyright',
    },
    {
      id: 'eox',
      dataset: 'Sentinel-2 cloudless 2016',
      license: 'CC BY 4.0',
      text: 'Sentinel-2 cloudless 2016 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016), CC BY 4.0. https://s2maps.eu',
      url: 'https://cloudless.eox.at',
    },
    {
      id: 'naturalearth',
      dataset: 'Natural Earth 10m land and island names',
      license: 'Public domain',
      text: 'Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.',
      url: 'https://www.naturalearthdata.com/',
    },
    {
      id: 'nativeland',
      dataset: 'Native Land Digital (linked, not stored)',
      license: 'Linked to their map; no data is copied',
      text: 'First stewards are shown on Native Land Digital’s own map (https://native-land.ca/). Their map does not represent or intend to represent official or legal boundaries of any Indigenous nations.',
      url: 'https://native-land.ca/',
    },
  ];
}
