import { useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { NasaExamples, CoverageTable } from "./SciencePanel";
import { SCIENCE_SOURCES, SCIENCE_DEFAULTS } from "./science";
const topics = [
  ["start", "Start here"],
  ["scenarios", "Scenarios A / B"],
  ["point", "Study point & time"],
  ["map", "Map & layers"],
  ["satellites", "Planning satellites"],
  ["geometry", "Geometry table"],
  ["science", "Mission analysis fields"],
  ["sites", "Site search"],
  ["plan", "Plan & tasks"],
  ["navigation", "Surface navigation"],
  ["reports", "Reports & saving"],
  ["workspace", "Tabs & windows"],
  ["ai", "AI assistant"],
  ["offline", "Offline maps"],
  ["examples", "NASA examples"],
  ["evidence", "Evidence & limitations"],
];
export default function HelpGuide({ startTour }: { startTour: () => void }) {
  const w = useWorkspace();
  const [topic, setTopic] = useState("start"),
    [collapsed, setCollapsed] = useState(false);
  const open = (id: string) => w.showPanel(id);
  return (
    <div className={`help-layout ${collapsed ? "nav-collapsed" : ""}`}>
      <aside>
        <button
          aria-label="Toggle help navigation"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "☰" : "◀ Collapse topics"}
        </button>
        {!collapsed && (
          <nav aria-label="Help topics">
            {topics.map(([id, label]) => (
              <button
                key={id}
                className={topic === id ? "active" : ""}
                onClick={() => setTopic(id)}
              >
                {label}
              </button>
            ))}
          </nav>
        )}
      </aside>
      <main>
        <h2>{topics.find((t) => t[0] === topic)?.[1]}</h2>
        {topic === "start" && (
          <>
            <p>
              Choose a place, choose dates, and compare whether your equipment
              can get sunlight and communicate. You can explore without knowing
              orbital mechanics.
            </p>
            <ol>
              <li>
                Use View → Pick study point and click the Moon, or choose a
                preset in Study properties.
              </li>
              <li>
                Set your start date in UTC and the number of hours to study.
              </li>
              <li>
                Open View → Mission analysis, enable models, and review the
                hardware assumptions.
              </li>
              <li>
                Use “Find nearby places with more sunlight” for fixed nearby
                points and a coarse Moon-wide grid. The global results are a
                shortlist, not an exhaustive optimum. Unknown terrain stays an
                estimate, not a measured improvement.
              </li>
              <li>
                For qualitative image review, connect a vision-capable local
                Ollama model in Preferences → AI & models, then review a
                candidate’s LOLA hillshade and elevation images. Use DEM
                measurements for numeric terrain checks.
              </li>
              <li>
                Check slope, unknown terrain, battery and communications
                together. “Unknown” means more data is needed, not “safe.”
              </li>
              <li>
                Build a mission plan, compare scenario B, and export a report
                with its assumptions.
              </li>
            </ol>
            <button className="primary" onClick={startTour}>
              Run tour
            </button>
            <p>
              No app calculation alone authorizes an astronaut or robot landing.
            </p>
          </>
        )}
        {topic === "navigation" && (
          <section>
            <button onClick={() => open("navigation")}>Open Surface Navigation</button>
            <p>Use Plan mission to set the lander, choose a rover or suited astronaut, and add up to six stops on the map. Find route proposes a stop order and a return leg. Turn on Keep my order to visit stops as entered. Mark a crater rim or other obstacle with Avoid area. Save an accepted route to reopen it from Saved routes.</p>
            <p>Use Add stops on map to place several stops without restarting the tool. Open a numbered stop to give it a name and description. Mission Plan uses the same stop list. The Apollo traverse practice template loads two stops and a prohibited area.</p>
            <p>Draw a Study region polygon, select it in Project explorer, and use Find landing sites and study windows here in Study properties. Region search samples interior points and ranks dates by measured sunlight and station contact across those samples.</p>
            <p>Use Return to lander from a mission stop or a position you pick on the map. The panel gives the next waypoint and its bearing from lunar north. ETA uses the effective pace and includes the planned stop time for a mission.</p>
            <p>Route screening uses the installed LOLA elevation grids to avoid steep terrain, including crater walls resolved by the grid. Outside detailed south polar coverage, LUNA uses the global LOLA grid with roughly 1.9 km spacing. Small craters, rocks, and steps below the terrain resolution require local hazard assessment. When screening is unavailable or finds no route, Find route shows a dashed Terrain unchecked sketch with distance and travel time. The sketch detours around prohibited areas. Its terrain has not been checked. The slope limits in Route settings are planning presets.</p>
            <p><a href="https://ntrs.nasa.gov/citations/20240001709">NASA VIPER traverse planning</a></p>
            <p>A practical rover navigator combines gyro heading with wheel odometry. Apollo used a directional gyro and incremental wheel odometers. Wheel slip makes odometry drift, while gyro bias accumulates into heading error. Cameras can provide visual odometry and crater or terrain matching can correct position against a map. Sun or star observations can provide heading references.</p>
            <p>Walking inertial navigation commonly detects steps and estimates heading. Foot-mounted systems can use zero-velocity updates when the foot is planted. A waist-mounted sensor needs step-length calibration. Lunar gravity, reduced-gravity gait, and a spacesuit change walking behavior, so Earth step calibration does not establish lunar accuracy.</p>
            <p>The Moon has no global magnetic field. Local crustal magnetic anomalies and nearby electronics make a magnetometer unreliable as a universal compass. MEMS accelerometers sense specific force through a moving proof mass and do not require a magnetic reference. Sensor bias, temperature, vibration, and electrical interference still affect measurements.</p>
            <p>Visual methods can struggle when the ground has few distinct features, or under deep shadow and glare. A USB sensor connected to a desktop is useful for bench experiments. Flight hardware needs qualification for lunar thermal vacuum, radiation, dust, vibration, and electromagnetic compatibility.</p>
            <h3>Connect an external sensor</h3>
            <p>Open External sensor in Surface Navigation using desktop Chromium on localhost or HTTPS. Connect a USB serial device, or connect a sensor through a microcontroller using its supported I²C or SPI interface and matching logic voltage. Use firmware that outputs one JSON object per line at 115200 baud. Select the matching port and close any other application using it.</p>
            <pre>{'{"v":1,"t_ms":12350,"accel":[0,0,9.80665],"gyro":[0,0,0],"wheel_m":0}'}</pre>
            <p>Use a strictly increasing device timestamp in milliseconds, specific force in m/s², optional gyro rates in rad/s, and optional cumulative forward wheel travel in meters. Send the available fields consistently, for example at 20 Hz. Remap the axes to +X forward, +Y left, +Z up. Extra fields such as magnetometer readings are ignored.</p>
            <p>Select Earth bench test for a stationary Earth device or Lunar for lunar telemetry. Enter the known heading, select the known map point, and hold still for two seconds before calibrating. Run replay to practice setup without hardware. A rover can use wheel and gyro data for relative motion. With six axes and no wheel data, rover estimation freezes after five seconds. A rover accelerometer alone can show specific force and stationary tilt. Walking can use step detection and a manually entered heading for each straight leg. Walk a measured distance to calibrate step length.</p>
            <p>After a telemetry interruption or wheel counter reset, confirm a known point and heading and re-anchor. A live ETA requires an active route and a position within its route corridor. Check the selected gravity, units, and sensor axes if calibration fails. <a href="https://developer.chrome.com/docs/capabilities/serial/">Web Serial documentation</a></p>
            <p>References: <a href="https://ntrs.nasa.gov/citations/20250000720">NASA lunar navigation survey</a>, <a href="https://ntrs.nasa.gov/citations/20230007028">NASA crater localization</a>, <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC4732172/">foot-mounted inertial navigation research</a>, <a href="https://science.nasa.gov/moon/solar-wind/">NASA lunar magnetic environment</a>.</p>
          </section>
        )}
        {topic === "scenarios" && (
          <>
            <p>
              A is your baseline choice. B is an alternative: another place,
              another date, or both. They share mission hardware and activity
              offsets, so you can study how an environmental change affects the
              same proposed mission.
            </p>
            <p>
              Use Mission time to line up both missions by hours since their own
              start. Use UTC to line up the same real clock time; a scenario
              outside that time range has no data.
            </p>
            <p>
              Duplicate A +24 hours copies the location and shifts the start by
              one day. Change B in Study properties, then compare the Sun/Earth
              chart and analysis. Activities are edited relative to A; the same
              elapsed offsets are evaluated in B.
            </p>
            <details>
              <summary>Scientific detail</summary>
              <p>
                A/B are independent SPICE topocentric evaluations of MOON_ME
                coordinates and UTC epochs. They are not statistical confidence
                bounds.
              </p>
            </details>
          </>
        )}
        {topic === "point" && (
          <>
            <p>
              Point name is a label. Latitude says north (+) or south (-).
              Longitude is east-positive; negative numbers mean west. Reference
              height is meters above the app's lunar sphere, not meters above
              local terrain.
            </p>
            <p>
              With a DEM enabled, the calculation uses local terrain elevation
              plus mast height. Without coverage, the explicit reference height
              remains and terrain obstruction is unknown.
            </p>
            <p>
              Start UTC is the mission's date and time, including seconds.
              Duration sets the analysis interval. Sample step trades speed for
              detail; smaller steps may find changes a coarse chart misses.
              Exact cursor UTC selects what time the map is showing. It does not
              change the mission start.
            </p>
            <details>
              <summary>Scientific detail</summary>
              <p>
                Moon reference radius 1,737,400 m. Frame MOON_ME / DE421; dates
                convert UTC to SPICE ET using a leap-second kernel. Physical
                event accuracy depends on data and models, not the number of
                digits in a field.
              </p>
            </details>
            <button onClick={() => open("inspector")}>
              Open Study properties
            </button>
          </>
        )}
        {topic === "map" && (
          <>
            <p>
              Drag to turn the Moon; pinch your trackpad or use + / - to zoom.
              Right-drag tilts the camera. Drag the dotted grip to move map
              tools. Whole Moon fits the globe; Focus frames the active study
              point.
            </p>
            <p>
              Crosshair picks a study point. Pin adds a note. Line draws a
              traverse, polygon outlines a region, and ruler measures
              curved-surface distance. Click several points and Finish to save a
              shape.
            </p>
            <p>
              Imagery shows the LROC mosaic. Elevation colors show height.
              Hillshade emphasizes terrain shape. Slope colors show steepness at
              the layer's resolution. These images do not turn the globe into a
              true 3D terrain mesh.
            </p>
            <p>
              Grid shows lunar coordinates. Lighting uses the current Sun
              direction. Sun / Earth arrows point toward those bodies. Stars
              appear only in 3D and are a visual background. Candidate markers
              show the nearby solar search, not approved landing sites.
            </p>
            <details>
              <summary>Scientific detail</summary>
              <p>
                Layer resolution varies. Native Site04 5 m DEM calculations and
                the regional 80 m DEM are separate from imagery. High map zoom
                is not evidence of rock-scale safety.
              </p>
            </details>
          </>
        )}
        {topic === "satellites" && (
          <>
            <p>
              Planning satellites let you explore “what if a relay were here?”
              Add multiple spacecraft and change their orbit colors or
              visibility. These circular orbits are assumptions, not live
              tracking.
            </p>
            <dl>
              <dt>Altitude (km)</dt>
              <dd>
                Distance above the mean lunar sphere; higher orbits generally
                move more slowly.
              </dd>
              <dt>Inclination (degrees)</dt>
              <dd>
                Tilt relative to the J2000 equator; this is not directly
                lunar-equator inclination.
              </dd>
              <dt>RAAN (degrees)</dt>
              <dd>Rotates the orbit plane around the J2000 reference axis.</dd>
              <dt>Phase (degrees)</dt>
              <dd>
                Starting position around the orbit at that scenario's start.
              </dd>
              <dt>Period</dt>
              <dd>
                Computed circular orbit time from altitude and lunar gravity.
              </dd>
            </dl>
            <details>
              <summary>Scientific detail</summary>
              <p>
                Two-body circular J2000 propagation, rotated into MOON_ME. No
                burns, perturbations, navigation covariance or certified relay
                link. The LRO example instead uses a definitive NASA SPK and
                rejects dates outside its coverage.
              </p>
            </details>
          </>
        )}
        {topic === "geometry" && (
          <>
            <p>
              The geometry table lists calculated samples. UTC is the exact
              sample time; elapsed hours are measured from that scenario's
              start. Sun/Earth azimuth is a compass direction around the local
              vertical and elevation is an angle above the local horizontal. A
              negative elevation puts the center below the ideal horizon.
            </p>
            <p>
              Angular radius is how large a body appears. Spacecraft coordinates
              are Moon-centered, body-fixed kilometers. The table's
              reference-plane geometry is separate from terrain-aware access,
              power and hazards in Mission analysis.
            </p>
            <button onClick={() => open("table")}>Open geometry table</button>
          </>
        )}
        {topic === "science" && (
          <>
            <p>
              Read the result cards with the site coverage and hardware
              assumptions. A zero eclipse duration means no eclipse was sampled;
              unknown terrain is not evidence of either a clear view or a
              failure.
            </p>
            <details>
              <summary>Selected-time values</summary>
              <p>
                The selected-time panel uses the nearest calculated sample to
                the timeline cursor. Sunlight is the modeled direct solar
                fraction; the range shows sensitivity bounds. Link margin is
                only useful when Earth is geometrically visible. Lunar eclipse
                duration is the interval when the Moon site is shadowed by
                Earth.
              </p>
            </details>
            <details>
              <summary>Terrain horizon chart</summary>
              <p>
                The chart plots sampled terrain elevation above the local
                horizontal by compass bearing. Hover the line, or focus it and
                use the arrow keys, to read the nearest sample. A gap is unknown
                terrain, not a zero-degree horizon. Sampling and far-field
                bounds are sensitivity screens, not a continuous-terrain
                guarantee.
              </p>
            </details>
            <details open>
              <summary>Terrain & landing fields</summary>
              <p>
                Mast height raises the observer above the DEM. Height
                uncertainty perturbs the sampled skyline. Horizon range is how
                far rays search; angular step controls bearing spacing. Smaller
                steps cost more computation. Footprint radius is the area
                screened around a point; slope and roughness limits are your
                vehicle-specific thresholds. Neither threshold can establish
                landing clearance.
              </p>
            </details>
            <details>
              <summary>Radio & stations</summary>
              <p>
                Station chooses Goldstone DSS-14, Canberra DSS-43 or Madrid
                DSS-63. Station mask excludes low Earth-station elevations.
                Frequency, transmit power/gain, receiver dish
                diameter/efficiency and system noise temperature determine
                nominal link strength. Bitrate sets energy per bit. Losses,
                required Eb/N0, implementation loss and reserve reduce the final
                margin. Positive margin still needs geometric access, actual
                hardware and station time.
              </p>
            </details>
            <details>
              <summary>Solar & battery</summary>
              <p>
                Panel area, efficiency and derating scale electrical generation.
                Tracking assumes a panel pointed at the Sun; fixed mode uses
                tilt and azimuth. Battery Wh is capacity; initial SOC is the
                starting fraction; minimum SOC is reserve. Charge/discharge
                efficiencies reduce usable energy. Base load runs continuously;
                active load adds for each overlapping activity except
                recharge/standby. Vehicle type exposes the ideal propulsive
                hopper screen.
              </p>
            </details>
            <details>
              <summary>Hopper fields</summary>
              <p>
                Dry mass, propellant and specific impulse estimate ideal
                delta-v. Launch speed and angle estimate a short vacuum
                ballistic hop. Thrust, guidance, fuel reserve and terrain
                collision avoidance are not modeled.
              </p>
            </details>
            <details>
              <summary>
                Exact model input keys and defaults (scientific)
              </summary>
              <pre>{JSON.stringify(SCIENCE_DEFAULTS, null, 2)}</pre>
            </details>
          </>
        )}
        {topic === "sites" && (
          <>
            <p>
              Site search screens the whole-Moon grid or points around the
              selected location. The mission-start list has a variable number
              of entries: a location appears there only when the configured
              sunlight, station-contact, overlap and measured-terrain checks
              all pass. If none qualify, the list is empty. Points with
              incomplete terrain coverage stay hidden; the result shows only
              how many checks lacked coverage.
            </p>
            <details open>
              <summary>How candidates are ranked</summary>
              <p>
                Results compare equivalent sunlight, selected DSN-site access,
                and hours when both are available. The current whole-Moon scan
                checks a deterministic 15° grid and makes detailed terrain
                attempts on a separated shortlist. Recommendations include
                only measured points that pass the active sunlight, contact,
                overlap and terrain limits. Identical inputs intentionally
                give reproducible results. The coarse grid can miss smaller
                sites between grid points.
              </p>
              <p>
                Missing DEM coverage means the sunlight/contact estimate uses a
                reference plane. Those coordinates stay hidden and do not count
                as a match. Coverage totals remain visible so a zero-result
                scan can be distinguished from a scan with no screened points.
              </p>
            </details>
            <details>
              <summary>What terrain data means</summary>
              <p>
                Terrain data are elevation measurements in a digital elevation
                model (DEM), separate from the map's camera imagery. LUNA uses
                LOLA elevation grids where available to estimate ground height,
                the local horizon, slope and surface roughness. The global scan
                first screens its grid against a reference plane; it does not
                evaluate a local DEM at every lunar point. “Not evaluated”
                means that broad screen did not inspect local elevation there.
                “Incomplete coverage” means elevation or horizon samples are
                missing for part of the point or time interval. In either case,
                solar and contact values may be reference-plane estimates, and
                they do not establish terrain safety.
              </p>
              <p>
                Detailed terrain is available only where the local DEM covers
                the site. The interface omits uncovered coordinates until that
                data is available.
              </p>
            </details>
            <details>
              <summary>Earliest date alternatives</summary>
              <p>
                The search checks UTC starts in chronological order, beginning
                today, within a finite 32-day window. It returns at most one
                best refined result for a date and looks for different sites
                for the alternatives. These are sampled starts, not
                continuous-time optima.
              </p>
            </details>
            <details>
              <summary>Image review</summary>
              <p>
                Optional terrain-image review requires a vision-capable local
                Ollama model. It interprets hillshade and elevation images
                qualitatively; DEM measurements remain the numerical source for
                slope and roughness screening.
              </p>
            </details>
            <button onClick={() => open("science")}>Open mission analysis</button>
          </>
        )}
        {topic === "plan" && (
          <>
            <p>
              Type a name, choose a type and minutes, then Add at cursor. Quick
              buttons make common activities. Expand a row for notes and exact
              start/duration.
            </p>
            <p>
              Drag a block along the timeline to reschedule it. Hover for its
              full name and UTC times. Drag a row onto another to resequence
              activities from T+0; that removes gaps. Tasks are untimed
              preparation/review checklist items.
            </p>
            <p>
              Mathematical recommendations look for known solar/reserve and
              sampled contact opportunities. Apply suggestions, then inspect the
              new battery trace and overlaps. AI can help draft a plan, but it
              does not validate mission safety.
            </p>
            <details>
              <summary>Candidate activity windows</summary>
              <p>
                The app checks up to 64 sample-aligned starts per activity for
                the first 20 activities and recalculates the battery trace for
                each start. A candidate is not a jointly optimized schedule,
                route, spacecraft trajectory or approved mission. Applying a
                start recalculates the analysis; review overlaps, contact and
                resource contention afterward.
              </p>
            </details>
            <button onClick={() => open("mission")}>Open mission plan</button>
            <button onClick={() => open("tasks")}>Open tasks</button>
          </>
        )}
        {topic === "reports" && (
          <>
            <p>
              File → Set up report chooses sections, paper, font, bullets and
              code coloring. Every Study report PDF includes a site image and a
              mission geometry chart. If live map imagery cannot be captured,
              LUNA inserts a clearly labeled coordinate schematic that does not
              represent terrain.
            </p>
            <p>
              JSON reopens the study with its inputs and results; Workspace JSON
              includes all open projects. CSV is for numerical samples or
              activity lists. Lunar GeoJSON and Moon KML preserve planetary
              coordinates; ordinary Earth GIS defaults are wrong. ICS adds UTC
              activities to a calendar. PNG captures the map; SVG exports the
              chart.
            </p>
            <p>
              Projects save locally in this browser. Keep file exports for
              backups. Cloud AI can send selected context/attachments to its
              provider; local model modes keep inference on this device.
            </p>
            <button onClick={() => w.openPreferences("report")}>
              Report setup
            </button>
          </>
        )}
        {topic === "workspace" && (
          <>
            <p>
              Drag project tabs to reorder projects. Drag panel tabs to split,
              tile or rearrange the interface. View opens a panel. Window
              provides mapping/planning/analysis layouts, float, pop-out and
              maximize commands. Window reset restores a usable layout without
              deleting projects.
            </p>
            <p>
              Pop-out panels require the main app window to stay open. Allow the
              browser's requested popup for LUNA if you choose that action.
            </p>
          </>
        )}
        {topic === "ai" && (
          <>
            <p>
              Choose a provider in Preferences → AI & models, connect it and
              select a discovered model. Open AI assistant from View. Ask it to
              compare A/B, draft activities, add review tasks or change the map.
              The activity log shows requested actions; review mode lets you
              apply edits explicitly.
            </p>
            <p>
              Attachments provide context, not authority to issue commands.
              Local models need sufficient RAM, storage and a supported
              runtime/GPU. Resource estimates are planning heuristics, not speed
              guarantees.
            </p>
          </>
        )}
        {topic === "offline" && (
          <>
            <p>
              Keep the local server running: app files, science kernels, DEMs
              and cached map tiles work without internet. Download your study
              region before disconnecting. The offline panel shows exactly what
              levels/area are present; a regional pack is not global
              high-resolution coverage.
            </p>
            <p>
              A complete high-quality global Moon pyramid can require
              substantial storage. The app must label missing tiles and cannot
              invent detail offline. Browser-local models also need their
              weights downloaded first. Cloud AI always needs network access.
            </p>
          </>
        )}
        {topic === "examples" && (
          <>
            <p>
              NASA-sourced working examples help you learn. Actual
              epochs/trajectories are distinguished from illustrative hardware.
              These are not NASA-approved or globally optimized missions.
            </p>
            <NasaExamples />
            <p>
              VIPER-style operations motivate reviewing sunlight, battery,
              slopes and contact together. LRO eclipse planning illustrates lost
              solar input. Repeating those checks in one workspace could reduce
              manual screening; no mission time savings are measured here.
            </p>
          </>
        )}
        {topic === "evidence" && (
          <>
            <CoverageTable />
            {SCIENCE_SOURCES.map((source) => (
              <details key={source.id}>
                <summary>{source.title}</summary>
                <p>{source.use}</p>
                <a href={source.url} target="_blank" rel="noreferrer">
                  Primary source ↗
                </a>
              </details>
            ))}
            <p>
              Independent mission validation, real hardware, terrain error
              ensembles, navigation dispersion, regolith, plume, thermal and
              rock-scale hazard evidence are still needed for flight use.
            </p>
            <p>
              Open source: Driver.js tour (MIT), Dockview (MIT), CesiumJS
              (Apache-2.0), jsPDF (MIT), Noto fonts (OFL).
            </p>
          </>
        )}
      </main>
    </div>
  );
}
