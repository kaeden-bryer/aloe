/**
 * Demo data. `CAUSES` and `PROJECTS` are copied verbatim from the design
 * prototype's `data()` method so the app shows the same projects and copy.
 * Everything the database needs that the design didn't have (repo URLs, task
 * specs, extra queued work, history) lives in `PROJECT_EXTRAS` below, keyed
 * by project id, so the design copy stays easy to diff against the original.
 */
import type { CauseId, TaskCategory } from "@aloe/core";

export interface DesignCause {
  id: CauseId;
  emoji: string;
  name: string;
  blurb: string;
  cover: string;
}

export type DesignTaskStatus = "merged" | "review" | "progress" | "open" | "decision";

export interface DesignProject {
  id: string;
  name: string;
  owner: string;
  cause: CauseId;
  also: CauseId[];
  type: string;
  region: string;
  tagline: string;
  about: string;
  url: string;
  urlLabel: string;
  registry: string;
  tasks: { title: string; status: DesignTaskStatus }[];
  decision: string;
}

export const CAUSES: DesignCause[] = [
  { id: 'climate', emoji: '🌎', name: 'Climate Change', blurb: 'Track forest carbon and cut emissions', cover: '#E4EFF5' },
  { id: 'electric', emoji: '⚡️', name: 'Electrification', blurb: 'Bring clean, reliable power to everyone', cover: '#FBF1D6' },
  { id: 'eco', emoji: '🌱', name: 'Eco Friendliness', blurb: 'Make greener everyday choices easier', cover: '#E5F2E3' },
  { id: 'farming', emoji: '🐄', name: 'Sustainable Farming', blurb: 'Tools for healthier soil and food systems', cover: '#F3ECE2' },
  { id: 'health', emoji: '💊', name: 'Health', blurb: 'Close gaps in access to care', cover: '#F7E7EB' }
];

export const PROJECTS: DesignProject[] = [
  {
    id: 'eae', name: 'Energy Access Explorer', owner: 'World Resources Institute', cause: 'electric', also: ['climate'],
    type: 'Open software', region: 'Africa and South Asia',
    tagline: 'Maps where clean energy would do the most good.',
    about: 'An open-source, interactive geospatial platform that helps governments, businesses and financiers find high-priority areas for energy access interventions. WRI says it has reached more than 100 governments across eight countries and over 25,000 users. It was registered as a digital public good in 2024, the first in the energy sector.',
    url: 'https://github.com/energyaccessexplorer', urlLabel: 'github.com/energyaccessexplorer',
    registry: 'https://www.digitalpublicgoods.net/r/energy-access-explorer',
    tasks: [
      { title: 'Add a data-quality check that flags outdated grid layers', status: 'merged' },
      { title: 'Write tests for the multi-criteria priority index', status: 'review' },
      { title: 'Speed up loading of 1 km raster layers', status: 'progress' },
      { title: 'Translate interface strings to Portuguese', status: 'open' },
      { title: 'Change the default weights for demand indicators', status: 'decision' }
    ],
    decision: 'Changing default weights changes which areas look like priorities, so a maintainer decides. Donor agents keep working on the rest of the queue.'
  },
  {
    id: 'biomass', name: 'Biomass Prediction Model', owner: 'vertify.earth', cause: 'climate', also: [],
    type: 'Open AI model', region: 'Forest carbon monitoring',
    tagline: 'Estimates forest biomass from satellite imagery.',
    about: 'An open AI model that predicts above-ground forest biomass from multi-spectral satellite imagery, built by vertify.earth for the GIZ Forest Forward initiative to support sustainable forest management and carbon monitoring. Its model card notes limited validation in some ecosystems, such as mangroves and wetlands.',
    url: 'https://huggingface.co/vertify/biomass-model', urlLabel: 'huggingface.co/vertify/biomass-model',
    registry: 'https://www.digitalpublicgoods.net/registry',
    tasks: [
      { title: 'Package inference as a command-line tool', status: 'merged' },
      { title: 'Write tests for GeoTIFF band checks', status: 'review' },
      { title: 'Add a validation report for mangrove and wetland sites', status: 'progress' },
      { title: 'Document the required Sentinel-1 and Sentinel-2 bands', status: 'open' },
      { title: 'Publish a new model version', status: 'decision' }
    ],
    decision: 'Releases always go to a human, so a maintainer signs off before a new model version is published.'
  },
  {
    id: 'off', name: 'Open Food Facts', owner: 'Open Food Facts (non-profit)', cause: 'eco', also: ['health'],
    type: 'Open data', region: 'Global',
    tagline: 'The open database of the food we buy.',
    about: 'A collaborative, open database of food products, often called the Wikipedia of food. Its data is used in more than 1,000 peer-reviewed papers on health and sustainability, and the project has a partnership with Santé publique France. It was added to the DPG registry in December 2024.',
    url: 'https://world.openfoodfacts.org', urlLabel: 'world.openfoodfacts.org',
    registry: 'https://www.digitalpublicgoods.net/r/open-food-facts',
    tasks: [
      { title: 'Add tests for ingredient-parsing edge cases', status: 'merged' },
      { title: 'Improve the docs for the public read API', status: 'review' },
      { title: 'Flag products that are missing packaging data', status: 'progress' },
      { title: 'Clean up duplicate category translations', status: 'open' },
      { title: 'Change how environmental impact appears on product pages', status: 'decision' }
    ],
    decision: 'How impact is shown to shoppers is a judgment about what counts as good, so it goes to a maintainer.'
  },
  {
    id: 'farmos', name: 'farmOS', owner: 'farmOS community', cause: 'farming', also: ['eco'],
    type: 'Open software', region: 'Global',
    tagline: 'Farm management, planning and record keeping.',
    about: 'A web-based application for farm management, planning and record keeping. Farmers use it to track operations and trace food from seed to sale, and researchers use it to compare lab results against soil-health practices. It has been a digital public good since 2022.',
    url: 'https://farmos.org', urlLabel: 'farmos.org',
    registry: 'https://www.digitalpublicgoods.net/r/farmos',
    tasks: [
      { title: 'Write API tests for quantity logs', status: 'merged' },
      { title: 'Add timezone tests for recurring logs', status: 'review' },
      { title: 'Add CSV import for soil test results', status: 'progress' },
      { title: 'Improve the farm map layer docs', status: 'open' },
      { title: 'Change the data model for harvest records', status: 'decision' }
    ],
    decision: 'Data model changes affect every farm using farmOS, so the steward sent this one to a maintainer.'
  },
  {
    id: 'accessmod', name: 'AccessMod', owner: 'University of Geneva GeoHealth group', cause: 'health', also: [],
    type: 'Open software', region: 'Low- and middle-income countries',
    tagline: 'Models how far people are from health care.',
    about: 'A free, open-source WHO-supported tool that models physical access to health services: travel time to the nearest facility, coverage when facilities lack staff or equipment, and referral times between facilities. Ministries of health use it to plan where new capacity helps most.',
    url: 'https://www.accessmod.org', urlLabel: 'accessmod.org',
    registry: 'https://www.digitalpublicgoods.net/r/accessmod',
    tasks: [
      { title: 'Add tests for referral-time analysis', status: 'merged' },
      { title: 'Write a guide to scaling-up scenarios', status: 'review' },
      { title: 'Speed up travel-time surface computation', status: 'progress' },
      { title: 'Validate road-speed tables on import', status: 'open' },
      { title: 'Export patient location data in a new format', status: 'decision' }
    ],
    decision: 'Anything touching personal data always goes to a human, so a maintainer reviews this export.'
  }
];

// ---------- Seeding-only extras (not in the design) ----------

export interface SeedDonor {
  id: string;
  name: string;
  email: string;
  causes: CauseId[];
  backs: string[];
  /** Verified results before this week, so trust levels look realistic. */
  priorVerified: number;
  deviceName: string;
}

export const DONORS: SeedDonor[] = [
  { id: "demo-donor", name: "Kaeden Bryer", email: "kaeden@example.org", causes: ["electric", "farming"], backs: ["eae", "farmos"], priorVerified: 3, deviceName: "Kaeden's MacBook Air" },
  { id: "demo-donor-2", name: "Mikko Laine", email: "mikko@example.org", causes: ["climate", "health"], backs: ["biomass", "accessmod"], priorVerified: 12, deviceName: "Mikko's workstation" },
  { id: "donor-priya", name: "Priya Nair", email: "priya@example.org", causes: ["eco", "electric"], backs: ["off", "eae"], priorVerified: 8, deviceName: "Priya's laptop" },
  { id: "donor-tomas", name: "Tomás Silva", email: "tomas@example.org", causes: ["climate", "health"], backs: ["biomass", "accessmod"], priorVerified: 6, deviceName: "Tomás's desktop" },
  { id: "donor-grace", name: "Grace Okafor", email: "grace@example.org", causes: ["farming", "eco"], backs: ["farmos", "off"], priorVerified: 9, deviceName: "Grace's laptop" },
];

/**
 * Demo maintainers: one per project, each only for their own project. They are
 * rows of `donors` (a maintainer is just a user with membership rows) but have
 * no devices or backings, since they are on the project's side, not donating.
 */
export const MAINTAINERS: { id: string; name: string; email: string; projectId: string }[] = [
  { id: "maintainer-ccf", name: "Miko Cool", email: "miko@example.org", projectId: "ccf" },
  { id: "maintainer-eae", name: "Wanjiru Kamau", email: "wanjiru@example.org", projectId: "eae" },
  { id: "maintainer-biomass", name: "Lars Eriksen", email: "lars@example.org", projectId: "biomass" },
  { id: "maintainer-off", name: "Camille Roux", email: "camille@example.org", projectId: "off" },
  { id: "maintainer-farmos", name: "Jonas Becker", email: "jonas@example.org", projectId: "farmos" },
  { id: "maintainer-accessmod", name: "Amara Diallo", email: "amara@example.org", projectId: "accessmod" },
];

/** Spec details for one task title. Goal defaults to the title. */
export interface SeedTaskSpec {
  category: TaskCategory;
  files: string[];
  criteria: string[];
  priority?: number;
}

export interface SeedHistoryItem extends SeedTaskSpec {
  title: string;
  daysAgo: number;
  author: string;
  verifier: string;
}

export interface ProjectExtras {
  repoUrl: string;
  testCommand: string;
  brief: string;
  /** Specs for the design's own task titles. */
  specs: Record<string, SeedTaskSpec>;
  /** Who does the design's in-flight work: author of 'review'/'decision', holder of 'progress', reviewer of 'review'. */
  people: { progress: string; reviewAuthor: string; reviewer: string; decisionAuthor: string; decisionVerifier: string };
  /** More queued work, so every project has a real queue. */
  extraQueued: (SeedTaskSpec & { title: string })[];
  /** Merged work over the last week (the design's 'merged' task is one of these). */
  history: SeedHistoryItem[];
}

export const PROJECT_EXTRAS: Record<string, ProjectExtras> = {
  eae: {
    repoUrl: "https://github.com/energyaccessexplorer",
    testCommand: "npm test",
    brief: "Energy Access Explorer helps planners find where energy access investments matter most. Keep map performance and data provenance first; never change how priority scores are computed without a maintainer.",
    specs: {
      "Add a data-quality check that flags outdated grid layers": { category: "feature", files: ["src/datasets/quality.js", "test/quality.test.js"], criteria: ["Grid layers older than 3 years show a warning badge", "The check runs when a dataset loads"] },
      "Write tests for the multi-criteria priority index": { category: "tests", files: ["src/analysis/index.js", "test/analysis/index.test.js"], criteria: ["Tests cover equal weights, zero weights and missing layers", "No production code changes"] },
      "Speed up loading of 1 km raster layers": { category: "feature", files: ["src/raster/loader.js"], criteria: ["1 km layers load at least 30% faster on the benchmark", "Rendered output is unchanged"] },
      "Translate interface strings to Portuguese": { category: "docs", files: ["locales/pt.json"], criteria: ["Every key in locales/en.json has a Portuguese entry", "No keys are added or removed"] },
      "Change the default weights for demand indicators": { category: "interface", files: ["src/analysis/defaults.js"], criteria: ["Default weights match the maintainer-approved table"] },
    },
    people: { progress: "demo-donor", reviewAuthor: "donor-priya", reviewer: "demo-donor-2", decisionAuthor: "donor-priya", decisionVerifier: "demo-donor-2" },
    extraQueued: [
      { title: "Add unit tests for the raster clipping helper", category: "tests", files: ["src/raster/clip.js", "test/raster/clip.test.js"], criteria: ["Tests cover polygons that cross the raster edge", "No production code changes"], priority: 9 },
      { title: "Add a versioned CSV export for priority-index results", category: "interface", files: ["src/export/csv.js", "test/export/csv.test.js"], criteria: ["Export includes a schema version column", "Existing export URLs keep working"], priority: 8 },
    ],
    history: [
      { title: "Add a data-quality check that flags outdated grid layers", category: "feature", files: ["src/datasets/quality.js"], criteria: ["Grid layers older than 3 years show a warning badge"], daysAgo: 5, author: "demo-donor", verifier: "demo-donor-2" },
      { title: "Add tests for the admin-boundary loader", category: "tests", files: ["test/boundaries.test.js"], criteria: ["Tests cover missing and malformed GeoJSON"], daysAgo: 3, author: "demo-donor", verifier: "donor-priya" },
      { title: "Fix lint warnings in the map controls", category: "lint", files: ["src/map/controls.js"], criteria: ["eslint reports no warnings in src/map"], daysAgo: 0, author: "demo-donor", verifier: "donor-tomas" },
      { title: "Update the Mapbox GL dependency", category: "deps", files: ["package.json", "package-lock.json"], criteria: ["The app builds and all tests pass"], daysAgo: 2, author: "donor-priya", verifier: "demo-donor" },
      { title: "Document the dataset upload format", category: "docs", files: ["docs/datasets.md"], criteria: ["Every required column is described"], daysAgo: 4, author: "donor-tomas", verifier: "donor-priya" },
      // Older weeks, so "vs last week" and the streak have something to compare with.
      { title: "Add a smoke test for the map view", category: "tests", files: ["test/map.test.js"], criteria: ["The map renders with the sample dataset"], daysAgo: 9, author: "demo-donor", verifier: "donor-priya" },
      { title: "Remove an unused chart dependency", category: "deps", files: ["package.json"], criteria: ["The app builds and all tests pass"], daysAgo: 23, author: "demo-donor", verifier: "demo-donor-2" },
    ],
  },
  biomass: {
    repoUrl: "https://huggingface.co/vertify/biomass-model",
    testCommand: "pytest",
    brief: "An open model that estimates forest biomass from Sentinel imagery. Reproducibility matters: pin versions, keep inference deterministic, and never publish a model version without a maintainer.",
    specs: {
      "Package inference as a command-line tool": { category: "feature", files: ["biomass/cli.py", "pyproject.toml"], criteria: ["`biomass predict in.tif out.tif` writes a prediction raster"] },
      "Write tests for GeoTIFF band checks": { category: "tests", files: ["biomass/io.py", "tests/test_bands.py"], criteria: ["Tests cover missing, extra and misordered bands", "No production code changes"] },
      "Add a validation report for mangrove and wetland sites": { category: "feature", files: ["reports/validation.py"], criteria: ["Report lists error metrics per ecosystem", "Runs on the public validation set"] },
      "Document the required Sentinel-1 and Sentinel-2 bands": { category: "docs", files: ["README.md", "docs/inputs.md"], criteria: ["Every band the model reads is listed with its resolution"] },
      "Publish a new model version": { category: "release", files: ["MODEL_CARD.md", "pyproject.toml"], criteria: ["Version bumped and model card updated"] },
    },
    people: { progress: "donor-tomas", reviewAuthor: "donor-tomas", reviewer: "demo-donor-2", decisionAuthor: "demo-donor-2", decisionVerifier: "donor-tomas" },
    extraQueued: [
      { title: "Pin Python dependencies with a lock file", category: "deps", files: ["requirements.lock", "pyproject.toml"], criteria: ["A fresh install reproduces the test environment"], priority: 3 },
      { title: "Add type hints to the preprocessing module", category: "lint", files: ["biomass/preprocess.py"], criteria: ["mypy passes on biomass/preprocess.py"], priority: 2 },
    ],
    history: [
      { title: "Package inference as a command-line tool", category: "feature", files: ["biomass/cli.py"], criteria: ["`biomass predict` writes a prediction raster"], daysAgo: 4, author: "demo-donor-2", verifier: "donor-tomas" },
      { title: "Add docstrings to the band-stacking utilities", category: "docs", files: ["biomass/bands.py"], criteria: ["Every public function has a docstring"], daysAgo: 2, author: "donor-priya", verifier: "demo-donor-2" },
      { title: "Upgrade rasterio to the latest minor release", category: "deps", files: ["pyproject.toml"], criteria: ["All tests pass"], daysAgo: 1, author: "donor-tomas", verifier: "demo-donor" },
    ],
  },
  off: {
    repoUrl: "https://github.com/openfoodfacts/openfoodfacts-server",
    testCommand: "make unit_test",
    brief: "Open Food Facts is a collaborative database of food products. Data quality and contributor trust come first; anything that changes what shoppers see on product pages goes to a maintainer.",
    specs: {
      "Add tests for ingredient-parsing edge cases": { category: "tests", files: ["lib/ProductOpener/Ingredients.pm", "tests/unit/ingredients.t"], criteria: ["Tests cover nested parentheses and percentages"] },
      "Improve the docs for the public read API": { category: "docs", files: ["docs/api/read.md"], criteria: ["Every query parameter has an example", "Rate limits are documented"] },
      "Flag products that are missing packaging data": { category: "feature", files: ["lib/ProductOpener/DataQuality.pm"], criteria: ["Products without packaging data get a data-quality tag"] },
      "Clean up duplicate category translations": { category: "lint", files: ["taxonomies/categories.txt"], criteria: ["No category has two translations in the same language"] },
      "Change how environmental impact appears on product pages": { category: "interface", files: ["templates/web/pages/product/includes/environment.tt.html"], criteria: ["Layout matches the maintainer-approved mockup"] },
    },
    people: { progress: "donor-grace", reviewAuthor: "donor-grace", reviewer: "donor-priya", decisionAuthor: "donor-priya", decisionVerifier: "donor-grace" },
    extraQueued: [
      { title: "Add tests for barcode checksum validation", category: "tests", files: ["lib/ProductOpener/Products.pm", "tests/unit/barcode.t"], criteria: ["Tests cover EAN-8, EAN-13 and UPC-A"], priority: 4 },
      { title: "Remove contributor emails from debug logs", category: "personal-data", files: ["lib/ProductOpener/Users.pm"], criteria: ["No email address is written to any log"], priority: 2 },
    ],
    history: [
      { title: "Add tests for ingredient-parsing edge cases", category: "tests", files: ["tests/unit/ingredients.t"], criteria: ["Tests cover nested parentheses"], daysAgo: 3, author: "demo-donor-2", verifier: "donor-grace" },
      { title: "Fix broken links in the API docs", category: "docs", files: ["docs/api/"], criteria: ["The link checker reports no broken links"], daysAgo: 2, author: "donor-grace", verifier: "donor-priya" },
      { title: "Remove unused Perl modules", category: "lint", files: ["cpanfile"], criteria: ["All tests pass"], daysAgo: 0, author: "donor-priya", verifier: "donor-grace" },
    ],
  },
  farmos: {
    repoUrl: "https://github.com/farmOS/farmOS",
    testCommand: "vendor/bin/phpunit",
    brief: "farmOS is used by farms around the world to keep records. Stability matters more than speed: data-model and API changes always go to a maintainer.",
    specs: {
      "Write API tests for quantity logs": { category: "tests", files: ["modules/core/quantity/tests/"], criteria: ["Tests cover create, update and delete over JSON:API"] },
      "Add timezone tests for recurring logs": { category: "tests", files: ["modules/core/log/tests/"], criteria: ["Tests cover a DST change and a non-UTC farm timezone"] },
      "Add CSV import for soil test results": { category: "feature", files: ["modules/import/csv/"], criteria: ["A sample lab CSV imports as lab test logs", "Bad rows are reported, not silently skipped"] },
      "Improve the farm map layer docs": { category: "docs", files: ["docs/development/module/map.md"], criteria: ["Every layer option has an example"] },
      "Change the data model for harvest records": { category: "interface", files: ["modules/log/harvest/"], criteria: ["Migration preserves every existing harvest record"] },
    },
    people: { progress: "donor-priya", reviewAuthor: "donor-grace", reviewer: "donor-tomas", decisionAuthor: "donor-grace", decisionVerifier: "demo-donor" },
    extraQueued: [
      { title: "Add tests for the movement log API", category: "tests", files: ["modules/core/log/tests/"], criteria: ["Tests cover moving an asset between two locations"], priority: 5 },
      { title: "Document the soil-test CSV columns", category: "docs", files: ["docs/guide/import.md"], criteria: ["Every column is described with units"], priority: 3 },
    ],
    history: [
      { title: "Write API tests for quantity logs", category: "tests", files: ["modules/core/quantity/tests/"], criteria: ["Tests cover create, update and delete"], daysAgo: 5, author: "demo-donor", verifier: "donor-grace" },
      { title: "Add tests for the asset archive endpoint", category: "tests", files: ["modules/core/asset/tests/"], criteria: ["Archived assets are hidden by default"], daysAgo: 2, author: "demo-donor", verifier: "demo-donor-2" },
      { title: "Fix typos in the installation guide", category: "docs", files: ["docs/hosting/install.md"], criteria: ["The spell checker reports no errors"], daysAgo: 1, author: "demo-donor-2", verifier: "demo-donor" },
      { title: "Bump Drupal core to the latest patch release", category: "deps", files: ["composer.json", "composer.lock"], criteria: ["All tests pass"], daysAgo: 3, author: "donor-grace", verifier: "donor-tomas" },
      { title: "Document the quantity log fields", category: "docs", files: ["docs/model/logs.md"], criteria: ["Every field has a description and units"], daysAgo: 16, author: "demo-donor", verifier: "donor-grace" },
    ],
  },
  accessmod: {
    repoUrl: "https://github.com/fxi/AccessMod_shiny",
    testCommand: "Rscript -e 'testthat::test_dir(\"tests\")'",
    brief: "AccessMod models physical access to health care for ministries of health. Results inform where clinics are built, so correctness beats speed, and anything that touches patient data goes to a maintainer.",
    specs: {
      "Add tests for referral-time analysis": { category: "tests", files: ["R/referral.R", "tests/test_referral.R"], criteria: ["Tests cover unreachable facilities"] },
      "Write a guide to scaling-up scenarios": { category: "docs", files: ["docs/scaling-up.md"], criteria: ["Walks through one complete scenario with screenshots"] },
      "Speed up travel-time surface computation": { category: "feature", files: ["R/travel_time.R"], criteria: ["Benchmark region runs at least 25% faster", "Results are identical to the previous version"] },
      "Validate road-speed tables on import": { category: "feature", files: ["R/import_speed.R"], criteria: ["Negative or missing speeds are rejected with a clear message"] },
      "Export patient location data in a new format": { category: "personal-data", files: ["R/export.R"], criteria: ["Export format approved by the data protection lead"] },
    },
    people: { progress: "donor-tomas", reviewAuthor: "demo-donor-2", reviewer: "donor-tomas", decisionAuthor: "donor-tomas", decisionVerifier: "demo-donor-2" },
    extraQueued: [
      { title: "Add tests for the travel-scenario table parser", category: "tests", files: ["R/scenario.R", "tests/test_scenario.R"], criteria: ["Tests cover missing land-cover classes"], priority: 4 },
      { title: "Update the R package dependencies", category: "deps", files: ["DESCRIPTION", "renv.lock"], criteria: ["All tests pass on the updated lock file"], priority: 2 },
    ],
    history: [
      { title: "Add tests for referral-time analysis", category: "tests", files: ["tests/test_referral.R"], criteria: ["Tests cover unreachable facilities"], daysAgo: 4, author: "demo-donor-2", verifier: "donor-tomas" },
      { title: "Document the merge-landcover step", category: "docs", files: ["docs/landcover.md"], criteria: ["Every input layer is described"], daysAgo: 1, author: "donor-tomas", verifier: "demo-donor-2" },
      { title: "Lint the R sources with lintr", category: "lint", files: ["R/"], criteria: ["lintr reports no warnings"], daysAgo: 5, author: "donor-grace", verifier: "donor-tomas" },
    ],
  },
};
