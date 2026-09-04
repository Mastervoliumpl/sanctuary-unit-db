# SanctuaryDB

Tools for _Sanctuary: Shattered Sun_, generated directly from the game's own data
files. Currently three pages:

- **/** — unit database: every unit with costs, stats, weapons and build trees
- **/calculator/** — build time, resource drain and economy planning
- **/maps/** — community maps: browse, preview and download

Built with [TanStack Start](https://tanstack.com/start) (React + TypeScript on
Vite), prerendered to a purely static site — there is no server at runtime.
The game data pipeline is separate: plain Node scripts that read a local game
install and commit their output to `public/`.

## Quick start

Needs Node 22.12+ (`engines` enforces it; Vite 7 won't run on less).

```bash
npm install
npm run dev       # Vite dev server at http://localhost:5173
npm test          # unit tests over the calculators, grouping and data invariants
npm run typecheck # tsc
npm run build     # prerender every route to dist/client/
npm run verify    # check public/ data + art are complete (no game needed)

npm run refresh   # extract + icons: regenerate data from a local game install
```

`refresh` is `npm run extract` (game data → `public/data/units.json`) followed by
`npm run icons` (`icons-src/` → `public/icons/`, plus both manifests).

`extract` finds the game automatically by reading Steam's `libraryfolders.vdf`,
preferring the Playtest branch over the older Demo when both are installed. If
it can't (non-standard install, or you copied the files elsewhere), point it
manually:

```bash
SANCTUARY_PATH="D:/SteamLibrary/steamapps/common/Sanctuary Shattered Sun Demo" npm run extract
```

### Maintaining modding snapshots

Each release gets an immutable URL namespace under
`src/content/modding/docs/<game-version>-<steam-build>/`. Add and order its MDX
pages in that directory's `meta.json`, add matching build metadata under
`src/content/modding/snapshots/`, then register the snapshot in
`src/content/modding/registry.ts`. The highest numeric Steam build becomes the
default; array order does not control it.

Every MDX page needs `title`, `description`, and `navTitle` frontmatter. Keep
links snapshot-relative so the version switcher can preserve the current page.
Corrections to an old snapshot should stay scoped to what was true for that
inspected build; new game behavior belongs in a new snapshot. Unit tests reject
missing metadata, broken internal links, duplicate builds, and navigation drift.

## Publishing maps

`/maps` lists community maps. The zips are not in the repo — each map is a
GitHub release asset (tag `map-<slug>`), so downloads cost nothing and the
GitHub API supplies live download counts. The repo carries only
`public/data/maps.json` plus each map's preview and screenshots.

```bash
npm run addmap -- path/to/My_Map.zip                    # or the map folder itself
npm run addmap -- My_Map.zip --shots a.jpg b.jpg --desc "Two lanes, one bridge."
```

The script reads everything else (name, author, size, player count, water)
from the `.sanmap` inside, uploads the zip to the release, and updates
`public/`; commit and push to publish. Re-running for the same map bumps its
version and replaces the asset. It authenticates with `GITHUB_TOKEN` or the
same stored credential `git push` uses.

The site's copy of each preview goes through `scripts/png.js`, a small
built-in PNG decoder/encoder. The generator writes them barely compressed, so
re-encoding with a proper filter and deflate cuts the pack from 38 MB to 11 MB.
It is pixel-for-pixel lossless and deliberately applies no tone adjustment:
these are true-colour terrain renders, so the colours are left exactly as
rendered.

## Pages

Routes are files in `src/routes/` (TanStack Router file-based routing); each is
prerendered at build time and hydrates into an SPA.

| Page          | Route file                  | What it does                              |
| ------------- | --------------------------- | ----------------------------------------- |
| `/`           | `src/routes/index.tsx`      | Unit database — the aligned faction board |
| `/calculator` | `src/routes/calculator.tsx` | Build time, drain and economy planning    |
| `/maps`       | `src/routes/maps.tsx`       | Community maps, and each map's own page   |

All UI state lives in the URL as typed search params — filters, sort, the open
unit, the calculator setup — using the same param names and encoding as the
pre-framework site, so old shared links keep working. The router uses a custom
search serializer (`src/router.tsx`) because every param here is a plain
string and the default would JSON-quote numeric-looking values.

`src/components/Header.tsx` renders the shared chrome and publishes the
measured header height as `--header-h` so the sticky sidebar and column
headers line up without a hard-coded offset that drifts whenever the chrome
changes.

Adding a page means a new file in `src/routes/` and a `<Link>` in the header.

## The calculator

Everything comes from the formulas the schema documents, so the numbers match
the game rather than being modelled:

```
seconds        = buildTime / total build power      (assisting builders add up)
drain per sec  = cost / seconds
```

So three T2 engineers (10 build power each) on a T3 Land Factory — 4,200 build
time, 2,000 alloy, 20,000 energy — take 140s and draw 14.29 alloy/s and 142.86
energy/s.

**Who can build what is not a free choice.** Every unit carries a `builtBy` list,
resolved from the builders' `canBuild` tag expressions, so a T1 air factory
cannot start a T4 bot — the Ares can only be begun by a Chosen T3 Engineer or T3
Engineering Station. The builder picker is limited to that list and re-checks
itself whenever the target changes, including when restoring from a URL.

**Assisting a construction is gated on reach, not on the Assist order.**
`construction.range` is what lets a unit pour build power into someone else's
build. A factory has 10 build power but no range, so it contributes nothing to a
construction. Exactly **22 units have a range**: the commanders, the engineers
and the engineering stations.

The `Assist` order on the other 42 builders is not wrong, it describes a
different mechanic — ordering a factory to assist another factory copies its
build queue rather than helping construct anything. Both fields are meaningful;
only `construction.range` is the one that adds build power, which is what the
calculator is measuring.

Both pickers are inline dropdown panels with a search field and icon rows; a
plain select over a couple of hundred units is unusable.

The economy panel sums `production`, `maintenanceConsumption` and `storage`
across a set of structures. Those values are already per second in the templates
(`resourceEntity.lua` divides them by `Constants.TickRate` internally).

The third panel is the one worth having: it compares build drain against net
income and stretches the build time by the shortfall, since a build that outruns
your economy stalls rather than failing. That 140s factory takes **16m 40s** on
four extractors and two T1 generators.

Setups are kept in the URL, so a build can be shared or bookmarked.

## Adjacency

`host/systems/adjacencyBuffs.lua` defines bonuses structures pass to neighbours.
It isn't a plain literal — `targetTags` are Lua expressions like
`Tags.FACTORY + Tags.ENGINEERING_STATION` — so `readAdjacencyBuffs` reads each
block with a regex instead of the table parser.

29 units grant a buff, across six types:

| Source                              | Effect                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| Alloy Extractor                     | −10% alloy build cost to adjacent factories / engineering stations              |
| T1/T2/T3 Energy Generator           | −2.5% / −10% / −15% energy build cost, and the same off radar and shield upkeep |
| T1 Alloy Storage, T1 Energy Storage | +20% storage to adjacent storage of the same kind                               |

Several buffs defined in that file are wired to no unit at all (the alloy
fabricators, T2/T3 storages), so they're dropped rather than advertised as live.
The effect is shown on the granting structure, since that's the side the
templates describe.

## Standing economy

A unit's build cost is a one-off; 51 units also have a rate that runs forever
after, and that's usually the number that decides whether you can afford them.
A T3 Shield is 600 alloy once and **250 energy every second** thereafter.

There are **three** roles here, not two, and the game picks between them purely
on which economy blocks a template has
(`host/units/unitsClasses/unitsBaseClass.lua:630`):

| ResourceEntity | Template has                  | Count | Reads as        |
| -------------- | ----------------------------- | ----- | --------------- |
| `generation`   | `production` only             | 22    | free income     |
| `production`   | both                          | 3     | a **converter** |
| `consumption`  | `maintenanceConsumption` only | 26    | pure upkeep     |

The middle case is the one worth separating out. A converter's output is scaled
by how well its input is met — `ResourceEntity.productionMultiplier` is
documented as "Lowest satisfaction of all consumed resources" — so the Alloy
Furnace's 10 alloy/s is what its 1,000 energy/s _buys_, not a bonus on top of
it. Listing those as a "Produces" line and an "Upkeep" line reads as a generator
that happens to cost something, which is exactly backwards, so the furnaces get
a conversion line instead.

`narutalProducer` (sic) on a template would force the free-income case even with
a consumption block. No template in the current data sets it, so the rule above
is exactly the game's.

Note that extractors and generators are _not_ on this list as consumers — they
draw nothing. Only radar, sonar, shields, stealth fields and the furnaces do.

## Upgrades cost the target's full price

An in-place upgrade is not a discounted transform, and nothing is refunded for
the structure it replaces. `UpgradeBehaviorThread`
(`host/units/unitsClasses/unitsDefault.lua:177`) calls `CreateUnit` for the
target at the structure's own position and then builds it like any other unit,
and that unit's construction entity is charged its own template cost and build
time (`unitsBaseClass.lua:155`). So the upgrade price is simply the target's
cost — a T1 Alloy Extractor reaching T2 pays the T2's full 600 alloy and 6,000
energy.

What differs from an ordinary build is who supplies the build power: **the
structure raises its own replacement**, so the wall-clock time is
`target.buildTime / source.buildPower` — 600 / 5 = 120s for that extractor,
drawing 5 alloy/s and 50 energy/s. Engineers can assist, since the half-built
upgrade is an ordinary buildable.

That is also the whole reason a radar or an extractor carries build power at
all. All **33** units with build power and an empty `builds` list have an
`upgradesTo` (`economy.test.ts` pins this), so the number is an upgrade rate,
not a builder stat — showing it in the economy list implied a capability those
structures don't have, so it moved into the upgrade block where it explains the
time. Real builders keep it.

## Where the data comes from

### Which game version

The game has no version string of its own — Unity's `bundleVersion` is a
permanent `1.0` and nothing in the Lua tree names a release — so the **Steam
build id** is the version. `extract.js` reads it from the
`appmanifest_<appid>.acf` beside the install and records it as `meta.game`
in `units.json` (and in the tiny `public/data/version.json`), and every data
page's toolbar shows `Build 25114838 · 4 Sep 2026`: the build the numbers came
from, and the day they were extracted. Hover it for detail.

The dot next to it is live. `GET /api/game-version` is a public, CORS-open
endpoint (cached five minutes) that answers with both halves:

```json
{
  "appId": 4511930,
  "branch": "public",
  "data": { "buildId": 25114838, "updatedAt": "…", "generatedAt": "…", "unitCount": 295 },
  "live": { "buildId": 25114838, "updatedAt": "…" },
  "upToDate": true
}
```

Valve publishes no key-free way to read a branch's build id, so `live` comes
from [api.steamcmd.net](https://api.steamcmd.net), a public mirror of
`app_info_print`. When that lookup fails `live` is `null`, `upToDate` is `null`
and the dot goes grey; the data half is always served. Anything — the in-game
mod, a bot — can poll the same URL to see whether a patch has outrun the site.

**The install ships two complete Lua trees, and they disagree.** This caught me
out, so read this before changing any path:

|                      | `engine/LJ/lua`                                     | `prototype/RuntimeContent/Lua`          |
| -------------------- | --------------------------------------------------- | --------------------------------------- |
| Balance data         | **newer** (Aug 12)                                  | older (Jul 22, untouched since install) |
| `availableUnits.lua` | 295 entries, `OK` / `NO_MODEL` / … `(DEMO_UI_ONLY)` | 270 entries, freeform notes             |
| `canBuild` grammar   | AND, **OR and parentheses**                         | AND only                                |
| Maps                 | 93                                                  | 0 (baked into `level0–10` scenes)       |
| Unit models / icons  | Playtest: `Sanctuary_Data/Gamedata/*.sanpack`       | Demo: `level0–10` scenes                |

89 of 283 units differ on cost, health or build time — the Tempest is 3000 HP in
one and 6000 in the other. The extractor reads **`engine`** for unit data. Set
`SANCTUARY_TREE=prototype` to read the older data for comparison.

Where the art lives moved between branches: the Demo bakes unit LODs into
Unity's `level0–10` scene files, while the Playtest — which ships no
`prototype` tree at all — packs them into `Sanctuary_Data/Gamedata/*.sanpack`.
`scanUnitModels` reads both, in chunks, since one of those packs is 1.4 GB and
does not fit in a single JS string. That scan decides `status`, so if a refresh
ever reports every unit as `no-model`, look there first.

Under whichever tree, the files used are:

| Path                             | What it gives us                                                  |
| -------------------------------- | ----------------------------------------------------------------- |
| `unitsTemplates/<id>/<id>.santp` | One file per unit — cost, health, weapons, movement, tags         |
| `availableUnits.lua`             | QA sign-off status per unit, with reason codes (engine tree only) |
| `templateExplainations.lua`      | The devs' own annotated schema, including the build-time formula  |

Every `.santp` is a pure Lua table literal — no functions, requires or
conditionals — so `scripts/lua-parser.js` reads them directly. All 283 templates
parse with zero failures; anything that isn't a plain literal throws rather than
silently producing a wrong number.

## The aligned faction board

The site lays units out as three faction columns with equivalent units on the
same row, so you can compare a T1 engineer across all three at a glance.

That alignment comes from the ids themselves. Templates are named
`u<faction><domain><code>`, so `uel1001` / `ucl1001` / `ugl1001` are the same
roster slot — Puma, Gladius and Gimlet. Dropping the faction letter gives the
row key. 80 of 113 slots have all three factions; where one is missing the cell
is left as a dashed placeholder rather than closing the gap, so the hole is
visible.

Eleven slots have factions that diverge in purpose (one gets a repair station
where another gets a shield booster). The row takes the most common label and
each card keeps its own name, so the divergence shows rather than hiding.

Sorting by a metric reorders whole rows — ranked by their most extreme member —
so the alignment survives sorting.

## How derived values are calculated

Most fields are copied straight across. Several are computed, and the assumptions
matter if you're using this for balance work:

**DPS.** Ported from the game's own `AI/AIFunctions.lua` —
`GetWeaponDamagePerSecond` and `GetWeaponCycleMuzzleCount` — with one deliberate
fix (see point 3). Don't reimplement it from intuition; four separate things
make the naive version wrong:

```
muzzleCount = sum of muzzles over salvoSize groups, wrapping: ((i-1) % groupCount) + 1
cycleTime   = max(reloadTime, (salvoSize - 1) * muzzleSalvoDelay)
DPS         = (damage * muzzleCount + damageOverTimePulses) / cycleTime
```

1. **Beam `damage` is per tick, not per shot,** and the game runs at
   `Constants.TickRate = 10`. `beamLifetime` says which kind:
   `-1` continuous (`damage x muzzles x 10`, **reloadTime is irrelevant**),
   `1` pulse — one tick per reload, `N` burst — N ticks per reload.
   Auger is a continuous beam: 25.64 x 10 = **256.4 DPS**, not 25.64/3 = 8.5.
2. **Salvo indices wrap around the muzzle groups.** A weapon with a salvo of 20
   over 1 group fires that group 20 times a cycle. Capping at the group count
   put Quasar at 18.75 DPS instead of 375.
3. **Reload runs concurrently with the salvo, SupCom-style.** The weapon state
   machine (`host/units/weaponsClasses/weaponsBaseClass.lua`) resets
   `reloadTimer` as the salvo _starts_ and keeps counting it down while the
   salvo plays out, so the cycle is `max(reload, salvo stretch)`, not their
   sum. The AI's own `GetWeaponDamagePerSecond` adds them — the one place this
   port diverges from it. In-game confirmation: the Chosen Commander (0.5s
   salvo delay, 1s reload) alternates barrels every half second with no pause,
   which the additive reading would break into fire-fire-pause. Following the
   AI's version had, e.g., Kodiak at 316.93 instead of 348.63.
4. **`damageOverTimePulseCount x damageOverTimePulseDamage`** adds to the
   numerator.

Beam totals only, before and after porting: Tripod Bot 453 → 2000, Hovertank
2955 → 6795, Engraver 333 → 3333, Auger 8.55 → 256.4. Pulse beams were already
right, which is why the error hid for so long.

**Weapons the game itself scores zero.** Four bomber weapons (Meteor, Inertia,
Impulse, TALEN) declare an empty `muzzles` list, so `table.getn` returns 0 and
the reference formula yields 0 DPS despite real damage values. That's a template
gap, not a genuine zero, so those report `dps: null` and render as "dps unknown"
rather than a confident 0.

### Which units are actually in the build

Availability is a **three-way** status, from two independent signals.

**Signal 1 — does it have art?** A unit's mesh, material and textures are all
named `<tpId>_lod<n>`, so scanning the `level*` scene files gives a verifiable
list of what would render:

```
u[ecgw][lans]\d{4}(?=_lod\d)
```

226 of 283 units. `extract.js` does this itself in about a second — a plain
string scan, no asset tooling. That's the `hasModel` field.

**Signal 2 — is it signed off?** The engine tree's `availableUnits.lua` is a
live QA tracker, not the stale list the prototype tree carries. Its reason codes
line up with the shipped art almost exactly:

| Reason                        | Count | Have art |
| ----------------------------- | ----- | -------- |
| `OK` / true                   | 140   | 140      |
| `OK_PENDING_APPROVAL` / false | 64    | 64       |
| `NO_MODEL` / false            | 61    | 5        |
| `OK` / false                  | 9     | 9        |
| `BONE_MISSMATCH` / false      | 7     | 7        |
| `BATTLE_NO_DAMAGE` / false    | 1     | 1        |

So the boolean means _"signed off and enabled"_, not _"exists"_ — the non-`OK`
codes describe units that are modelled but gated. Crossing the two gives:

- **`in-game`** (140) — has art, signed off and enabled
- **`in-progress`** (86) — has art, but gated: pending approval, rigging
  mismatch, or no damage state. `statusReason` carries which.
- **`no-model`** (57) — nothing to render

The Availability filter defaults to `in-game`. In-progress units keep their
faction colour and carry a `WIP` tag with the reason on hover, since they have
real art and real numbers — only `no-model` units are dimmed.

Note the prototype tree's copy of this file is _not_ usable this way: it uses
freeform notes that contradict themselves (`ugl2002 = false, -- model exist`).
The three-way split only works against the engine tree.

### Which weapon block is live

Templates carry **two** weapon representations, and they disagree — 40 of 75
comparable units differ on primary-weapon damage, 22 on reload, 20 on turn rate.
Reading the wrong one gives plausible but wrong numbers throughout, so this is
worth knowing before touching anything weapon-related.

The top-level `weapons` array is current. `turrets` is legacy:

- `templateExplainations.lua:376` opens a section commented `-- Old format, still
have some leftover stuff`, and `turrets` (line 414) is inside it.
- The same file documents the current schema with LuaLS annotations —
  `---@class WeaponTemplate` and `---@field weapons WeaponTemplate[]?`.
- `templateUpdater.lua` has `UpdateWeaponFormat`, a migration that builds
  `tp.weapons` from `tp.turrets` and ends with `tp.weapons = newWeapons` followed
  by a commented-out `--tp.turrets = nil`. That's why both blocks still exist.

Confusingly the runtime Lua still reads `tp.turrets` (host and client
`SetUpWeapons`, and `templateLoader.lua`'s FFI call), and weapon count comes from
`Engine.GetUnitTurretCount`. Whatever the engine does internally, `turrets` holds
the stale values the comment warns about — beam weapons don't exist in that
format at all, and several units including two Commanders have `weapons` with no
`turrets` block. This project reads `weapons` throughout.

**Turn rates.** Two separate things, both surfaced:

- _Unit_ turn rate is `movement.rotationSpeed`, in degrees per second (10–300
  across the roster).
- _Weapon_ turn rate comes from `aimControllers`, split by axis: controllers
  bound to a `yawBone` traverse, those bound to a `pitchBone` elevate. Most
  common speed per axis wins, same tie-break as projectile speed. Range is
  5–360°/s. Deliberately **not** `turrets[].turnRateDegreesPerSecond`, which is
  the legacy value and disagrees on 20 weapons.

`yawMin`/`yawMax` give the traverse arc. Most turrets are a free-spinning 360°;
anything less is flagged "(limited)", and a weapon with no yaw controller at all
is a fixed forward mount — the EDA Commander's gun only elevates.

**Weapon grouping.** Big units mount the same gun many times: the Phoenix lists
nine weapons that are really three designs, the T5 Hovertank eleven that are
four. Identical entries collapse into one carrying a `count`, so every unit in
the data has at most four distinct weapons and the UI can show all of them
rather than picking a "main" one. Each group reports `dps` per instance and
`dpsTotal` for the group; the unit's `dps` is the sum of the totals.

One weapon — the Phoenix's `AOEDelayedCluster` — has `damage = 0` because it
uses `useDamageCollider`, meaning damage comes from the projectile rather than
the weapon entry. It's shown as "damage on impact" instead of a bare zero.

**Projectile speed.** Not on the weapon, and not on the projectile template —
those are visuals, audio and collision only. It lives on the weapon's
`aimControllers`, and a weapon can have several:

```
ucl4002 aim[0]  speed 30  solver LowArc   aimBone Turret01_Yaw01     <- turret yaw
        aim[1]  speed  6  solver HighArc  aimBone Turret01_Muzzle01  <- real firing solution
        aim[2]  speed  6  solver HighArc  aimBone Turret01_Muzzle04
```

The yaw controller carries a coarse lead estimate; the muzzle-bound ones carry
the actual value. So the extractor prefers controllers whose `aimBone` names a
muzzle and takes the most common speed among them, breaking ties low. Five
weapons in the current data have controllers that disagree this way.

Two exclusions:

- **Beams** report `null`. They apply damage along their length rather than
  launching anything, so their controllers' speed is a lead artefact, not travel
  time. 12 units are beam-only and have no projectile speed at all.
- **The T1 Bomber** declares `0.0001`, meaning the bomb drops under gravity. Every
  genuine speed in the data is ≥ 5, so anything below 1 is treated as absent.

The unit-level `projectileSpeed` is the main weapon's, ranked by DPS _among
weapons that actually fire a projectile_ — so a unit whose highest-DPS weapon is
a beam still reports its cannon rather than nothing. Both the cards and the
detail panel list every weapon separately, so nothing is hidden behind that pick.

**Death explosions.** Templates list these in the `weapons` array with
`category = "DeathExplosion"`. They only trigger on death, so they're pulled out
into a separate `deathExplosion` field and excluded from DPS and range.

**Build tree.** `construction.canBuild` is a boolean tag expression. `*` is AND,
`+` is OR, and parentheses group:

```
Tags.EDA * Tags.BUILDABLE_BY_T1_FACTORY * ((Tags.LAND * Tags.MOBILE) + Tags.LAND_FACTORY)
```

A land factory builds EDA land units _or_ another land factory — that second
branch is the upgrade chain. 27 of the 69 expressions use the OR form, and they
only appear in the `engine` tree; `prototype` uses AND alone. Splitting on `*`
parses them into nonsense and costs ~90 units their builders, so this is a real
recursive-descent parser (`compileTagExpression`), and an expression that fails
to parse is reported rather than silently yielding an empty build list.

An atom naming a template id rather than a tag (`"Tags.ugs3805"`) matches that
one unit — that's how in-place structure upgrades are written. Each builder is
evaluated against every unit to produce `builds`, which is inverted to give each
unit its `builtBy`, and `upgradesTo` is folded in too.

Build time is stored in build-power-seconds, so wall-clock time depends on the
builder: `buildTime / builder.buildPower`. The detail panel shows this per builder
rather than a single misleading number.

`upgradesTo` is folded in here but priced separately — see
[Upgrades cost the target's full price](#upgrades-cost-the-targets-full-price),
since an upgrade is paid for by the structure itself rather than by a builder.

## Icons

The site uses the game's own strategic icons, with a generated SVG fallback for
the handful of combinations the game never shipped. 269 of 283 units get real
artwork; the other 14 are disabled naval and T4 structures whose icons don't
exist in the build.

**The `iconUI` field in the templates is dead.** It names files like
`tech1_land1_direct.png` which appear nowhere in the game — the string doesn't
occur in any asset file or in `GameAssembly.dll`. `templateControl.lua` has it
commented out and `selectionSystem.lua` carries a "remove this once icons are
updated" TODO. Don't build anything on it.

What the game actually does is composite icons at runtime from the three parts:

```lua
-- unitsBaseClass.lua
local imageName = string.format("%s_%s_%s_normal", iconTp.shape, iconTp.tech, iconTp.symbol)
self:AddIcon("StrategicIcon", "Unit", imageName, self:GetColor())
```

So the real assets are named `land1_t1_direct_normal` — shape, tech, symbol, in
that order — and live in the `level*` scene files, not in `resources.assets`.
Each has four states (`normal`, `over`, `selected`, `selected_over`); only
`normal` is used here.

They are **two-tone tint masks**: magenta marks the region the game recolours
with the player's colour (note `GetColor()` above), black is the glyph and
outline. Shipped as-is they render as magenta squares, so `npm run icons` bakes
one copy per faction using the palette in `public/icons.js`.

### Re-extracting

`icons-src/` holds the 136 extracted masters and is committed, so `npm run icons`
works on a clean checkout. You only need to redo the extraction if the game's
art changes — which is rare, unlike the balance data.

Extraction needs [AssetStudioModCLI](https://github.com/aelurum/AssetStudio)
(the GUI-only AssetRipper can't be scripted — its file loading always opens a
native OS dialog). With that unpacked somewhere:

```bash
AssetStudioModCLI "<game>/prototype/Sanctuary Shattered Sun_Data/level2" \
  -m export -t tex2d,sprite -g none -f assetName -o out/ \
  --filter-by-name "^(land|air|bot|naval|structure|experimental)[0-9]_t[0-9]_" --filter-with-regex
```

Then copy `*_normal.png` into `icons-src/` with the `_normal` suffix stripped and
run `npm run icons`. On a machine with only a newer .NET runtime installed, set
`DOTNET_ROLL_FORWARD=Major`.

## Unit previews

The detail panel shows the game's own rendered unit thumbnail — the image its
build menu uses. These are `Texture2D` assets named exactly after the template
id (`uel1001.png`), sitting alongside the model's `_albedo_team` / `_mask` /
`_normal_alpha` textures in the same `level*` scene files.

222 of 283 units have one — 222 of the 226 that have models, the four gaps being
units whose preview is a fully transparent placeholder. `npm run icons` detects
those and leaves them out of the manifest, so the panel is omitted rather than
showing an empty frame.

They're **64×64, and that's the only size that exists** (checked across scene
files). The UI upscales to 132px with smooth filtering on a faction-tinted
backdrop, which hides the softness reasonably well. Don't go much larger.

Unlike the strategic icons these need no processing — colours are already baked
in — so they live in `public/previews/` directly. `npm run icons` just indexes
them into `previews/manifest.json`.

To re-extract, same tool as the icons:

```bash
AssetStudioModCLI "<game>/prototype/Sanctuary Shattered Sun_Data/level2" \
  -m export -t tex2d -g none -f assetName -o out/ \
  --filter-by-name "^u(e|c|g|w)(l|a|n|s)[0-9]{4}$" --filter-with-regex
```

That regex matches the template-id naming exactly, which keeps the model
textures out. Drop the results into `public/previews/` and re-run `npm run icons`.

### 3D models

Not done, and not planned. Extraction isn't the hard part — AssetRipper will
give you meshes. The problem is that Unity materials and shaders don't map onto
glTF, so you get untextured geometry unless you rebuild materials per unit, and
then you still need a conversion pipeline, a viewer, mesh compression and a few
hundred MB of hosting. One model is an afternoon; 283 is a separate project.

## Caveats

- Currently built from the **demo** install, so balance values are provisional.
  `meta.isDemo` is set in the JSON if you want to surface that in the UI later.
- The site defaults to the 140 signed-off units. Another 86 are modelled but
  gated, and 57 have no model at all — use the Availability filter to see them.
- Nothing here is authoritative. Re-run `npm run extract` after a game patch.

## Deploying

**The extraction scripts are local-only. Production never runs them** — it
can't, because there's no game install on a build server. The split is:

- `npm run build` (Vite) only needs the **committed** `public/data` + art, so
  it runs anywhere, including on Vercel. The content pages are prerendered
  and served as static files, exactly as before.
- Since the ladder was added, the build's server bundle (`dist/server/`) is
  deployed too: `vercel.json` uses the `tanstack-start` preset, which wraps it
  in a serverless function for the server functions and `/api/auth/*` routes.
  The ladder needs env vars (see `.env.example`): `DATABASE_URL`,
  `STEAM_API_KEY`, `SESSION_SECRET`, `SITE_URL`.

  Production builds and servers require `SITE_URL` as an absolute HTTP(S) origin without a path, query, or
  fragment. Document canonicals and sitemap entries use that origin. Missing or invalid values fail the build.
  Use the deployed public origin in hosting configuration; `http://localhost:4173` is only for local browser tests.
  Steam sign-in only works on the origin `SITE_URL` names — not on preview
  deployment URLs. The database schema lives in `supabase/migrations/`, applied
  with `supabase db push` (or pasted into the SQL editor).

- `npm run extract` / `icons` / `refresh` need the game install and only ever
  run on your machine. Their output is committed.

```bash
vercel deploy
```

The workflow after a game patch is: `npm run refresh` locally, `npm run verify`,
`npm test` (it pins known-good derived values, so a surprising diff here is
either a real balance change or an extractor regression), then commit the
regenerated `public/` and push. CI (`.github/workflows/ci.yml`) runs verify,
typecheck, tests and the build on every push — none of it needs the game.

If you ever want extraction automated, it has to run somewhere the game files
exist — a self-hosted runner or your own machine on a schedule — pushing the
regenerated JSON. It cannot run on Vercel.

## Layout

```
icons-src/          136 extracted icon masters (committed; source for npm run icons)
scripts/            local-only data pipeline, plain Node
  lua-parser.js     Lua table literal -> JS
  locate-game.js    finds the install via Steam's library index
  extract.js        templates -> public/data/units.json
  build-icons.js    icons-src/ -> per-faction PNGs (zero-dep PNG codec)
  verify.js         checks public/ data + art consistency (no game needed)
supabase/
  migrations/       ladder database schema + SQL functions (pairing, Elo)
src/                the site, TanStack Start + React + TypeScript
  router.tsx        router factory + legacy-compatible search param encoding
  routes/
    __root.tsx      document shell, head, shared header
    index.tsx       unit board route: filters, sort, detail — all URL state
    calculator.tsx  calculator route: build/economy setup — all URL state
    ladder*.tsx     ladder: leaderboard/queue, match room, player profiles
    api.auth.*.ts   server-only routes for Steam OpenID sign-in/out
  server/           server-function layer (service-role Supabase, sessions,
                    Steam OpenID, queue + match logic) — never in the client
  lib/
    types.ts        the Unit type — the one contract for units.json
    data.ts         cached fetch of units.json + both manifests
    board.ts        grouping, filtering, sorting (pure functions)
    calc.ts         build/economy maths, option pools, URL row packing
    economy.ts      standing economy roles, upgrade price/time/payback
    maps.ts         maps.json fetch, download counts, size labels
    clipboard.ts    copy-to-clipboard with a fallback
    elo.ts          ladder rating maths (mirrored in supabase/migrations)
    matchmaking.ts  queue radius/pairing rules (mirrored likewise)
    ladder-maps.ts  the ranked map pool (official 1v1 maps)
    *.test.ts       vitest suites, run against the committed units.json
  components/       Header, HeaderSearch, UnitIcon (art + SVG fallback),
                    UnitCard, DetailPanel
public/             static assets copied verbatim into the build
  data/units.json   generated
  data/version.json generated: the Steam build the data came from (for /api/game-version)
  data/maps.json    generated by addmap
  maps/<slug>/      map previews and screenshots
  icons/            generated: <faction>/*.png plus manifest.json
  previews/         extracted unit renders plus manifest.json
```

`public/data/units.json`, `public/icons/` and `public/previews/` are all
committed — the Vercel build bundles the app around them without needing the
game.
