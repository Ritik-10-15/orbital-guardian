// ============================================================
// src/components/Globe.tsx
// Option A + F upgrades:
//   ✦ NASA Blue Marble texture + animated dot
//   ✦ Multi-spacecraft fleet — all members rendered simultaneously
//   ✦ Each fleet member has its own colour + orbit track
// ============================================================

import React, { useRef, useMemo, useEffect, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../store/useStore'
import type { LiveFrame } from '../types'

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

// ── Orbit track line ─────────────────────────────────────────
  function OrbitTracks() {
  const { fleet } = useStore()

  return (
    <>
      {fleet.filter(m => m.active && m.orbit_points.length > 1).map(member => {
        const pts = member.orbit_points.map(p =>
          latLonAltToVec3(p.latitude_deg, p.longitude_deg, p.altitude_km)
        )
        const geometry = new THREE.BufferGeometry().setFromPoints(pts)
        return (
          <line key={member.id}>
            <primitive object={geometry} attach="geometry" />
            <lineBasicMaterial color={member.colour} opacity={0.75} transparent />
          </line>
        )
      })}
    </>
  )
}
// ── Animated spacecraft dot ───────────────────────────────────
// Smoothly interpolates between successive live frames
function FleetDots() {
  const { fleet, activeFleetId, setActiveFleetId } = useStore()

  return (
    <>
      {fleet.filter(m => m.active && m.live_frame).map(member => {
        const frame = member.live_frame!
        const pos = latLonAltToVec3(frame.latitude_deg, frame.longitude_deg, frame.altitude_km)
        const isActive = member.id === activeFleetId

        return (
          <group key={member.id} position={pos}>
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

// ── Debris markers (positioned on actual orbit shell) ────────
function DebrisMarkers() {
  const { fleet, activeFleetId, setSelectedEvent } = useStore()
  const active = fleet.find(m => m.id === activeFleetId)
  const events = active?.events ?? []

  return (
    <>
      {events.slice(0, 20).map((ev, i) => {
        const colour =
          ev.risk_level === 'CRITICAL' ? '#dc2626' :
          ev.risk_level === 'HIGH'     ? '#ea580c' :
          ev.risk_level === 'MODERATE' ? '#ca8a04' : '#6b7280'

        const lon = (i / Math.max(events.length, 1)) * 360 - 180
        const lat = (i % 3 - 1) * 15
        const pos = latLonAltToVec3(lat, lon, 410)

        return (
          <mesh key={ev.debris_name + i} position={pos} onClick={() => setSelectedEvent(ev)}>
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
