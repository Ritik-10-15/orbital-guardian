// ============================================================
// src/components/Globe.tsx
// Option A + F upgrades:
//   ✦ NASA Blue Marble texture + animated dot
//   ✦ Multi-spacecraft fleet — all members rendered simultaneously
//   ✦ Each fleet member has its own colour + orbit track
//   ✦ Debris markers placed at real conjunction geometry
// ============================================================

import React, { useRef, useMemo, useEffect, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../store/useStore'
import type { LiveFrame, ConjunctionEvent } from '../types'

const EARTH_RADIUS = 1
const SCALE        = 1 / 6371   // km → scene units

// Convert lat / lon / alt → 3-D cartesian (ECI-aligned, Y-up)
function latLonAltToVec3(lat: number, lon: number, alt: number): THREE.Vector3 {
  const r     = EARTH_RADIUS + alt * SCALE
  const phi   = (90 - lat)  * (Math.PI / 180)
  const theta = (lon + 180) * (Math.PI / 180)
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta),
  )
}

// ── Earth with NASA Blue Marble texture ──────────────────────
function Earth() {
  const meshRef = useRef<THREE.Mesh>(null)

  // NASA Blue Marble 2048 px — served from public/textures/
  // Falls back gracefully if texture hasn't been placed yet
  const [textures, setTextures] = useState<{
    map?: THREE.Texture
    specularMap?: THREE.Texture
    bumpMap?: THREE.Texture
  }>({})

  useEffect(() => {
    const loader = new THREE.TextureLoader()
    const load   = (url: string) =>
      new Promise<THREE.Texture | null>(resolve => {
        loader.load(url, resolve, undefined, () => resolve(null))
      })

    Promise.all([
      load('/textures/earth_daymap.jpg'),
      load('/textures/earth_specular.jpg'),
      load('/textures/earth_bump.jpg'),
    ]).then(([map, specularMap, bumpMap]) => {
      // Ensure textures use sRGB encoding so colours render correctly
      if (map)         map.colorSpace         = THREE.SRGBColorSpace
      if (specularMap) specularMap.colorSpace  = THREE.SRGBColorSpace
      setTextures({
        map:         map         ?? undefined,
        specularMap: specularMap ?? undefined,
        bumpMap:     bumpMap     ?? undefined,
      })
    })
  }, [])

  // Slow self-rotation (~1 revolution / 100 s for demo)
  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.rotation.y += delta * 0.03
  })

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[EARTH_RADIUS, 64, 64]} />
      {textures.map ? (
        <meshStandardMaterial
          map={textures.map}
          metalnessMap={textures.specularMap}
          normalMap={textures.bumpMap}
          normalScale={new THREE.Vector2(0.05, 0.05)}
          roughness={0.8}
          metalness={0.1}
        />
      ) : (
        // Fallback solid colour while textures load
        <meshPhongMaterial
          color="#1a3a5c"
          emissive="#0a1a2e"
          specular="#4a90d9"
          shininess={15}
        />
      )}
    </mesh>
  )
}

// ── Single orbit track — memoized so geometry is never re-created per frame ──
function OrbitTrack({ points, colour, id }: {
  points: THREE.Vector3[]
  colour: string
  id: string
}) {
  // useMemo ensures the BufferGeometry is only rebuilt when points actually change
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(points)
    return g
  }, [points])

  return (
    <line key={id}>
      <primitive object={geometry} attach="geometry" />
      <lineBasicMaterial color={colour} opacity={0.75} transparent />
    </line>
  )
}

// ── Orbit tracks — one per active fleet member ────────────────
function OrbitTracks() {
  const { fleet } = useStore()

  return (
    <>
      {fleet.filter(m => m.active && m.orbit_points.length > 1).map(member => {
        const pts = member.orbit_points.map(p =>
          latLonAltToVec3(p.latitude_deg, p.longitude_deg, p.altitude_km)
        )
        return (
          <OrbitTrack
            key={member.id}
            id={member.id}
            points={pts}
            colour={member.colour}
          />
        )
      })}
    </>
  )
}
// ── Animated spacecraft dot ───────────────────────────────────
// ── Spacecraft dots — one per active fleet member, falls back to first orbit point if no live_frame ─
function FleetDots() {
  const { fleet, activeFleetId, setActiveFleetId, scrubberIndex, scrubberActive } = useStore()

  return (
    <>
      {fleet.filter(m => m.active).map(member => {
        // When scrubber is active for this member, use the scrubbed position
        const isActiveMember = member.id === activeFleetId
        const scrubPoint = (scrubberActive || scrubberIndex > 0) && isActiveMember && member.orbit_points.length > 0
          ? member.orbit_points[Math.min(scrubberIndex, member.orbit_points.length - 1)]
          : null

        const framePos = scrubPoint
          ? latLonAltToVec3(scrubPoint.latitude_deg, scrubPoint.longitude_deg, scrubPoint.altitude_km)
          : member.live_frame
          ? latLonAltToVec3(member.live_frame.latitude_deg, member.live_frame.longitude_deg, member.live_frame.altitude_km)
          : member.orbit_points.length > 0
          ? latLonAltToVec3(member.orbit_points[0].latitude_deg, member.orbit_points[0].longitude_deg, member.orbit_points[0].altitude_km)
          : null

        if (!framePos) return null
        const isActive = member.id === activeFleetId

        return (
          <group key={member.id} position={framePos}>
            <mesh onClick={() => setActiveFleetId(member.id)}>
              <sphereGeometry args={[isActive ? 0.02 : 0.014, 16, 16]} />
              <meshBasicMaterial color={member.colour} />
            </mesh>
            {isActive && (
              <mesh>
                <ringGeometry args={[0.026, 0.038, 24]} />
                <meshBasicMaterial color={member.colour} opacity={0.35} transparent side={THREE.DoubleSide} />
              </mesh>
            )}
          </group>
        )
      })}
    </>
  )
}
// ── Camera auto-focus — smoothly rotates to the active spacecraft ──
function CameraFocus() {
  const { fleet, activeFleetId } = useStore()
  const { camera } = useThree()
  const targetPos = useRef(new THREE.Vector3())
  const isFocusing = useRef(false)

  useEffect(() => {
    const active = fleet.find(m => m.id === activeFleetId)
    if (!active) return

    const framePos = active.live_frame
      ? latLonAltToVec3(active.live_frame.latitude_deg, active.live_frame.longitude_deg, active.live_frame.altitude_km)
      : active.orbit_points.length > 0
      ? latLonAltToVec3(active.orbit_points[0].latitude_deg, active.orbit_points[0].longitude_deg, active.orbit_points[0].altitude_km)
      : null

    if (framePos) {
      // Camera should end up looking at Earth from the direction of the spacecraft,
      // pulled back to a comfortable viewing distance
      const dir = framePos.clone().normalize()
      targetPos.current.copy(dir.multiplyScalar(2.6))
      isFocusing.current = true
    }
  }, [activeFleetId, fleet])

  useFrame((_, delta) => {
    if (!isFocusing.current) return
    camera.position.lerp(targetPos.current, Math.min(1, delta * 1.5))
    camera.lookAt(0, 0, 0)
    if (camera.position.distanceTo(targetPos.current) < 0.01) {
      isFocusing.current = false
    }
  })

  return null
}

// ── Debris markers — placed near the owning spacecraft's orbital position ──
//
// Each debris event is placed at the spacecraft's lat/lon but at a slightly
// different altitude and longitude derived from the conjunction's hours_to_tca
// and miss_distance_km, so markers orbit in the same shell as the spacecraft
// rather than being randomly distributed around the globe.
function DebrisMarkers() {
  const { fleet, setSelectedEvent } = useStore()

  // Collect (event, referenceFrame) pairs — only events from active members
  // that have a known current position
  const markers: Array<{
    ev: ConjunctionEvent
    lat: number
    lon: number
    alt: number
    colour: string
    key: string
  }> = []

  fleet.filter(m => m.active).forEach(member => {
    const frame = member.live_frame ?? (
      member.orbit_points.length > 0 ? member.orbit_points[0] : null
    )
    if (!frame) return

    member.events.slice(0, 10).forEach((ev, i) => {
      const colour =
        ev.risk_level === 'CRITICAL' ? '#dc2626' :
        ev.risk_level === 'HIGH'     ? '#ea580c' :
        ev.risk_level === 'MODERATE' ? '#ca8a04' : '#6b7280'

      // Spread debris markers around the spacecraft's current position:
      //   • longitude offset — proportional to hours_to_tca so nearer threats
      //     appear closer to the spacecraft dot, distant ones further along the track
      //   • altitude offset — proportional to miss_distance_km (1 km ≈ 0.05 scene units)
      //     so high-miss-distance events appear slightly above/below the orbit shell
      //   • latitude offset — small spread so stacked events don't overlap
      const lonOffset = ((ev.hours_to_tca % 90) / 90) * 120 - 60   // –60 … +60 °
      const latOffset = (i % 5 - 2) * 2.5                           // –5 … +5 °
      const altOffset = Math.min(ev.miss_distance_km * 2, 40)        // 0 … +40 km above s/c

      markers.push({
        ev,
        lat: frame.latitude_deg  + latOffset,
        lon: frame.longitude_deg + lonOffset,
        alt: frame.altitude_km   + altOffset,
        colour,
        key: `${member.id}__${ev.debris_name}__${i}`,
      })
    })
  })

  // Cap total at 30 to keep render cost bounded
  const visible = markers.slice(0, 30)

  return (
    <>
      {visible.map(({ ev, lat, lon, alt, colour, key }) => {
        const pos = latLonAltToVec3(lat, lon, alt)
        return (
          <mesh key={key} position={pos} onClick={() => setSelectedEvent(ev)}>
            <octahedronGeometry args={[0.016]} />
            <meshBasicMaterial color={colour} />
          </mesh>
        )
      })}
    </>
  )
}


// ── Atmosphere glow ──────────────────────────────────────────
function Atmosphere() {
  return (
    <mesh>
      <sphereGeometry args={[EARTH_RADIUS * 1.025, 64, 64]} />
      <meshBasicMaterial
        color="#1e40af"
        transparent
        opacity={0.07}
        side={THREE.BackSide}
      />
    </mesh>
  )
}

// ── Cloud layer (subtle, slow rotation) ─────────────────────
function Clouds() {
  const meshRef = useRef<THREE.Mesh>(null)
  const [tex, setTex] = useState<THREE.Texture | null>(null)

  useEffect(() => {
    new THREE.TextureLoader().load(
      '/textures/earth_clouds.jpg',
      t => setTex(t),
      undefined,
      () => {}   // silently skip if file missing
    )
  }, [])

  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.rotation.y += delta * 0.015
  })

  if (!tex) return null

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[EARTH_RADIUS * 1.005, 64, 64]} />
      <meshBasicMaterial
        map={tex}
        transparent
        opacity={0.25}
        depthWrite={false}
      />
    </mesh>
  )
}

// ── Main Globe component ─────────────────────────────────────
export function Globe() {
  return (
    <div style={{ width: '100%', height: '100%', background: '#020817' }}>
      <Canvas
        camera={{ position: [0, 0, 3], fov: 45 }}
        gl={{ antialias: true }}
      >
        {/* Lighting — sun from upper-right */}
        <ambientLight intensity={0.6} />
        <directionalLight
          position={[5, 3, 5]}
          intensity={1.2}
          color="#ffffff"
        />
        <pointLight position={[-5, -3, -5]} intensity={0.1} color="#4a90d9" />

        {/* Background stars */}
        <Stars radius={100} depth={50} count={4000} factor={4} fade />

        {/* Scene objects — order matters for transparency */}
        <Earth />
        <Clouds />
        <Atmosphere />
        <OrbitTracks />
        <DebrisMarkers />
        <FleetDots />
        <CameraFocus/>

        {/* Mouse controls */}
        <OrbitControls
          enablePan={false}
          minDistance={1.4}
          maxDistance={6}
          rotateSpeed={0.4}
          zoomSpeed={0.6}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>
    </div>
  )
}
