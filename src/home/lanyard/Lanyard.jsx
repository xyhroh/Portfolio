// The draggable ID-badge lanyard on the home page — built after Vercel's
// "interactive 3D event badge" walkthrough (react-three-fiber + Rapier
// physics + meshline): a chain of rope-jointed bodies hangs from a fixed
// point above the top of the canvas, the badge is the last link, and the
// strap is a meshline drawn through the chain's points every frame.
//
// Unlike the article there's no .glb: the badge is a rounded rectangle
// built in code, textured with card-front / card-back images from THIS
// folder. Replace those files (same name, png/jpg/jpeg/webp) and the
// badge updates on the next refresh. card-template.png shows the guides.
import * as THREE from "three";
import { createRoot } from "react-dom/client";
import { Suspense, createRef, useEffect, useRef, useState } from "react";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, useTexture } from "@react-three/drei";
import {
  BallCollider,
  interactionGroups,
  CuboidCollider,
  Physics,
  RigidBody,
  useRopeJoint,
  useSphericalJoint,
} from "@react-three/rapier";
import { MeshLineGeometry, MeshLineMaterial } from "meshline";

extend({ MeshLineGeometry, MeshLineMaterial });

// Glob (instead of a fixed `import x from "./card-front.png"`) so swapping in
// a .jpg or .webp of the same name doesn't break the build.
const pick = (mods) => Object.values(mods)[0];
const cardFront = pick(import.meta.glob("./card-front.{png,jpg,jpeg,webp}", { eager: true, import: "default" }));
const cardBack = pick(import.meta.glob("./card-back.{png,jpg,jpeg,webp}", { eager: true, import: "default" }));
const strapImage = pick(import.meta.glob("./strap.{png,jpg,jpeg,webp}", { eager: true, import: "default" }));

// 1024 x 1440 px images map exactly onto this (same 16:22.5 ratio).
const CARD_W = 1.6;
const CARD_H = 2.25;
const CARD_RADIUS = 0.12;
// The strap is three rope links hanging from a pin above the top of the screen.
// The pin is kinematic: it sits at HOME, but while the badge is dragged farther
// than the strap can reach, the pin is pulled along behind it (see useFrame), so
// the badge can go anywhere and the strap never has to stretch.
const LINK = 1.5;
const MAX_REACH = LINK * 3 - 0.15; // full strap length, minus a little slack
const HOME = new THREE.Vector3(0, 1 + LINK * 3, 0);
const NO_COLLISIONS = interactionGroups(1, []); // strap links pass through the badge

const cardShape = (() => {
  const w = CARD_W, h = CARD_H, r = CARD_RADIUS, x = -w / 2, y = -h / 2;
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
})();

// A flat face whose UVs run 0..1 across the whole card, so the image
// stretches edge to edge (ShapeGeometry's default UVs are raw x/y).
const faceGeometry = new THREE.ShapeGeometry(cardShape, 12);
const uv = faceGeometry.attributes.uv;
for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / CARD_W + 0.5, uv.getY(i) / CARD_H + 0.5);

// The thin dark slab between the two faces, so the badge has an edge.
const coreGeometry = new THREE.ExtrudeGeometry(cardShape, { depth: 0.02, bevelEnabled: false, curveSegments: 12 });
coreGeometry.translate(0, 0, -0.01);

const faceMaterialProps = { clearcoat: 1, clearcoatRoughness: 0.15, roughness: 0.3, metalness: 0.5 };

// where the last rope link meets the badge: just above its top edge, on the clamp
const ANCHOR_Y = CARD_H / 2 + 0.1;

// The physics bodies are shared between <Band> (which owns them) and <Strap> (which draws
// the strap and must run AFTER the physics step each frame — see <Strap>). One badge per page.
const chain = { fixed: createRef(), j1: createRef(), j2: createRef(), j3: createRef(), card: createRef() };

function Band() {
  const { fixed, j1, j2, j3, card } = chain;
  const pinTo = new THREE.Vector3(), vec = new THREE.Vector3(), ang = new THREE.Vector3(), rot = new THREE.Vector3(), dir = new THREE.Vector3();
  const segmentProps = { type: "dynamic", canSleep: false, colliders: false, angularDamping: 2, linearDamping: 2 };
  const [front, back] = useTexture([cardFront, cardBack]);
  const [dragged, drag] = useState(false);
  const [hovered, hover] = useState(false);

  const anchorY = ANCHOR_Y;

  useRopeJoint(fixed, j1, [[0, 0, 0], [0, 0, 0], LINK]);
  useRopeJoint(j1, j2, [[0, 0, 0], [0, 0, 0], LINK]);
  useRopeJoint(j2, j3, [[0, 0, 0], [0, 0, 0], LINK]);
  useSphericalJoint(j3, card, [[0, 0, 0], [0, anchorY, 0]]);

  useEffect(() => {
    if (hovered) {
      document.body.style.cursor = dragged ? "grabbing" : "grab";
      return () => void (document.body.style.cursor = "auto");
    }
  }, [hovered, dragged]);

  // no text selection while dragging the badge across the page
  useEffect(() => {
    if (dragged) {
      document.body.style.userSelect = "none";
      return () => void (document.body.style.userSelect = "");
    }
  }, [dragged]);

  useFrame((state, delta) => {
    if (dragged) {
      vec.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera);
      dir.copy(vec).sub(state.camera.position).normalize();
      vec.copy(state.camera.position).add(dir.multiplyScalar(-state.camera.position.z / dir.z)); // onto the z=0 plane
      [card, j1, j2, j3, fixed].forEach((ref) => ref.current?.wakeUp());
      vec.sub(dragged);
      // pull the pin along whenever the badge is dragged past the strap's reach
      dir.set(vec.x, vec.y + anchorY, vec.z).sub(HOME);
      const len = dir.length();
      pinTo.copy(HOME);
      if (len > MAX_REACH) pinTo.addScaledVector(dir, 1 - MAX_REACH / len);
      fixed.current?.setNextKinematicTranslation(pinTo);
      card.current?.setNextKinematicTranslation(vec);
    } else if (fixed.current && pinTo.copy(fixed.current.translation()).distanceTo(HOME) > 0.001) {
      // let go: the pin eases back home while the badge swings back down
      pinTo.lerp(HOME, Math.min(1, delta * 4));
      fixed.current.setNextKinematicTranslation(pinTo);
    }
    if (fixed.current) {
      // ease the badge's spin back toward facing the screen
      ang.copy(card.current.angvel());
      rot.copy(card.current.rotation());
      card.current.setAngvel({ x: ang.x, y: ang.y - rot.y * 0.25, z: ang.z });
    }
  });

  [front, back].forEach((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 16;
  });

  return (
    <>
      {/* the chain starts above the top of the canvas, so the strap enters from off-screen */}
      <group position={[0, 1 + LINK * 3, 0]}>
        <RigidBody ref={fixed} {...segmentProps} type="kinematicPosition" />
        <RigidBody position={[LINK * 0.5, 0, 0]} ref={j1} {...segmentProps}>
          <BallCollider args={[0.1]} collisionGroups={NO_COLLISIONS} />
        </RigidBody>
        <RigidBody position={[LINK, 0, 0]} ref={j2} {...segmentProps}>
          <BallCollider args={[0.1]} collisionGroups={NO_COLLISIONS} />
        </RigidBody>
        <RigidBody position={[LINK * 1.5, 0, 0]} ref={j3} {...segmentProps}>
          <BallCollider args={[0.1]} collisionGroups={NO_COLLISIONS} />
        </RigidBody>
        <RigidBody position={[LINK * 2, 0, 0]} ref={card} {...segmentProps} type={dragged ? "kinematicPosition" : "dynamic"}>
          <CuboidCollider args={[CARD_W / 2, CARD_H / 2, 0.01]} />
          <group
            onPointerOver={() => hover(true)}
            onPointerOut={() => hover(false)}
            onPointerUp={(e) => (e.target.releasePointerCapture(e.pointerId), drag(false))}
            onPointerDown={(e) => (
              e.target.setPointerCapture(e.pointerId),
              drag(new THREE.Vector3().copy(e.point).sub(vec.copy(card.current.translation())))
            )}
          >
            <mesh geometry={coreGeometry}>
              <meshStandardMaterial color="#1c1c1c" roughness={0.6} />
            </mesh>
            <mesh geometry={faceGeometry} position-z={0.0101}>
              <meshPhysicalMaterial map={front} {...faceMaterialProps} />
            </mesh>
            <mesh geometry={faceGeometry} position-z={-0.0101} rotation-y={Math.PI}>
              <meshPhysicalMaterial map={back} {...faceMaterialProps} />
            </mesh>
            <mesh position={[0, CARD_H / 2 + 0.02, 0]}>
              <boxGeometry args={[0.5, 0.2, 0.05]} />
              <meshStandardMaterial color="#111" roughness={0.35} metalness={0.8} />
            </mesh>
          </group>
        </RigidBody>
      </group>
    </>
  );
}

// The strap: a ribbon drawn through the chain every frame. It's a separate component, placed AFTER
// <Physics> in the tree, so its useFrame runs after the physics step (siblings subscribe in order).
// Inside <Band> it ran before the step and drew last frame's chain against this frame's badge, and
// with interpolation on, the badge was also drawn a fraction of a step behind the raw positions.
// Both showed up as the strap coming loose from the clamp. Physics is now un-interpolated, so the
// bodies' positions are exactly what's drawn. The strap's badge end is the clamp point itself
// (not the last link), so it can't come off even if the link lags under a hard pull.
function Strap() {
  const band = useRef();
  const strap = useTexture(strapImage);
  const { width, height } = useThree((state) => state.size);
  const [curve] = useState(() => {
    const c = new THREE.CatmullRomCurve3(Array.from({ length: 5 }, () => new THREE.Vector3()));
    c.curveType = "chordal";
    return c;
  });
  const [quat] = useState(() => new THREE.Quaternion());
  const [dir] = useState(() => new THREE.Vector3());

  strap.colorSpace = THREE.SRGBColorSpace;
  strap.wrapS = strap.wrapT = THREE.RepeatWrapping;

  useFrame(() => {
    const { fixed, j1, j2, card } = chain;
    if (!fixed.current || !card.current || !band.current) return;
    const q = card.current.rotation();
    curve.points[0].set(0, ANCHOR_Y, 0).applyQuaternion(quat.set(q.x, q.y, q.z, q.w)).add(card.current.translation());
    curve.points[1].copy(j2.current.translation());
    curve.points[2].copy(j1.current.translation());
    curve.points[3].copy(fixed.current.translation());
    // keep the strap running off the top of the screen even when the pin has been pulled down
    curve.points[4].copy(curve.points[3]).addScaledVector(dir.copy(curve.points[3]).sub(curve.points[2]).normalize(), 6);
    band.current.geometry.setPoints(curve.getPoints(64));  });

  return (
    <mesh ref={band} frustumCulled={false}>
      <meshLineGeometry />
      <meshLineMaterial
        color="white"
        depthTest={false}
        resolution={[width, height]}
        useMap
        map={strap}
        repeat={[-3, 1]}
        lineWidth={1.45}
      />
    </mesh>
  );
}

// The canvas covers the whole viewport (a fixed, click-through layer above the
// page) so the badge can be dragged anywhere. The #lanyard box in the hero is
// only a marker: each frame the camera is shifted/zoomed so the badge's rest
// spot lands on that box, at its size, and follows page scroll.
const CAM_Z = 8;
const HOME_VISIBLE_H = 2 * CAM_Z * Math.tan(THREE.MathUtils.degToRad(25 / 2)); // world height the box shows
const homeBox = document.getElementById("lanyard");

function CameraRig() {
  useFrame(({ camera, size }) => {
    const r = homeBox.getBoundingClientRect();
    if (!r.height) return;
    const unitsPerPx = HOME_VISIBLE_H / r.height;
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan((size.height * unitsPerPx) / 2 / CAM_Z));
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.position.x = -(r.left + r.width / 2 - size.width / 2) * unitsPerPx;
    camera.position.y = HOME_VISIBLE_H / 2 + (r.top - size.height / 2) * unitsPerPx;
  });
  return null;
}

createRoot(document.getElementById("lanyard-layer")).render(
  <Canvas
    camera={{ position: [0, 0, CAM_Z], fov: 25 }}
    dpr={[1, 1.5]}
    gl={{ alpha: true }}
    eventSource={document.body}
    eventPrefix="client"
  >
    <CameraRig />
    <ambientLight intensity={Math.PI} />
    <Suspense fallback={null}>
      <Physics gravity={[0, -40, 0]} timeStep={1 / 60} interpolate={false}>
        <Band />
      </Physics>
      <Strap />
    </Suspense>
    {/* no `background` prop: only used for reflections, so the page's white shows through */}
    <Environment blur={0.75}>
      <color attach="background" args={["black"]} />
      <Lightformer intensity={2} color="white" position={[0, -1, 5]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
      <Lightformer intensity={3} color="white" position={[-1, -1, 1]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
      <Lightformer intensity={3} color="white" position={[1, 1, 1]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
      <Lightformer intensity={10} color="white" position={[-10, 0, 14]} rotation={[0, Math.PI / 2, Math.PI / 3]} scale={[100, 10, 1]} />
    </Environment>
  </Canvas>
);
