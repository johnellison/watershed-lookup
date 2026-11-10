// Every dataset the pipeline downloads, from its official source. Nothing here is
// redistributed by this repository: running fetch-data means you accept each
// license yourself (see ATTRIBUTION.md).
export const HYBAS_REGIONS = ['af', 'ar', 'as', 'au', 'eu', 'gr', 'na', 'sa', 'si'];
export const HYBAS_LEVELS = ['05', '08'];

export const SOURCES = [
  ...HYBAS_REGIONS.flatMap((r) =>
    HYBAS_LEVELS.map((l) => ({
      id: `hybas_${r}_lev${l}`,
      url: `https://data.hydrosheds.org/file/HydroBASINS/standard/hybas_${r}_lev${l}_v1c.zip`,
      file: `hybas/hybas_${r}_lev${l}_v1c.zip`,
    })),
  ),
  {
    id: 'grdc_mrb',
    url: 'https://grdc.bafg.de/downloads/GRDC_Major_River_Basins_shp.zip',
    file: 'grdc/GRDC_Major_River_Basins_shp.zip',
  },
  {
    id: 'resolve_ecoregions',
    url: 'https://storage.googleapis.com/teow2016/Ecoregions2017.zip',
    file: 'resolve/Ecoregions2017.zip',
  },
  {
    id: 'ne_land',
    url: 'https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip',
    file: 'ne/ne_10m_land.zip',
  },
  {
    id: 'ne_regions',
    url: 'https://naciscdn.org/naturalearth/10m/physical/ne_10m_geography_regions_polys.zip',
    file: 'ne/ne_10m_geography_regions_polys.zip',
  },
  {
    id: 'geonames_postal',
    url: 'https://download.geonames.org/export/zip/allCountries.zip',
    file: 'geonames/allCountries.zip',
  },
];
