import * as THREE from 'three';

/**
 * Midtone tint for the fish (onBeforeCompile on a MeshStandardMaterial, so the textured, lit PBR shading stays).
 * The fish texture is grayscale: its mid-gray body takes the palette colour, darker details (scales, pupils) keep
 * their darkness relative to it, and light areas (eye whites, fins, highlights) fade back to the texture. A contrast
 * rim darkens the silhouette of light fish and lights up dark ones, so black and white fish stay readable on the
 * canal and the background.
 *
 * Config (render.models.fish.tint), luminances linear:
 *   strength         0..1, how much of the body takes the colour
 *   bodyLuminance    the texture body's luminance; it maps to exactly the palette colour
 *   highlightStart   the tint starts fading out above this texture luminance...
 *   highlightEnd     ...and is gone above this one
 *   minLuminance     each channel of a very dark palette colour is lifted to at least this, so a black fish keeps a
 *                    trace of shading and texture
 *   rim / rimPower   strength and falloff of the contrast rim (0 = off); rimLight / rimDark: its colours, picked by
 *                    the palette colour's luminance (under rimSwitch the rim is light, above it dark)
 */
const GLSL_UNIFORMS = /* glsl */ `
uniform vec3 fishTint;
uniform vec4 fishTintParams;
uniform vec4 fishRim;
uniform float fishRimPower;
`;

const GLSL_TINT = /* glsl */ `
{
  float fishLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  float fishMask = fishTintParams.x * ( 1.0 - smoothstep( fishTintParams.z, fishTintParams.w, fishLum ) );
  vec3 fishTinted = min( fishTint * ( fishLum / fishTintParams.y ), vec3( 1.0 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, fishTinted, fishMask );
  vec3 fishView = isOrthographic ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition );
  float fishEdge = pow( 1.0 - saturate( abs( dot( normal, fishView ) ) ), fishRimPower );
  diffuseColor.rgb = mix( diffuseColor.rgb, fishRim.rgb, fishRim.a * fishEdge );
}
`;

const luminance = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/**
 * A tinted copy of the fish's material for one palette colour (textures shared). All copies compile to one program.
 * @param {THREE.MeshStandardMaterial} base
 * @param {number} hex palette colour (sRGB hex)
 * @param {object} tint render.models.fish.tint
 */
export function fishTintMaterial(base, hex, tint) {
  const material = base.clone();
  material.name = `${base.name}#${hex.toString(16).padStart(6, '0')}`;
  const color = new THREE.Color(hex);
  const lifted = color.clone();
  lifted.r = Math.max(lifted.r, tint.minLuminance);
  lifted.g = Math.max(lifted.g, tint.minLuminance);
  lifted.b = Math.max(lifted.b, tint.minLuminance);
  const rim = new THREE.Color(luminance(color) < tint.rimSwitch ? tint.rimLight : tint.rimDark);
  const uniforms = {
    fishTint: { value: lifted },
    fishTintParams: { value: new THREE.Vector4(tint.strength, tint.bodyLuminance, tint.highlightStart, tint.highlightEnd) },
    fishRim: { value: new THREE.Vector4(rim.r, rim.g, rim.b, tint.rim) },
    fishRimPower: { value: tint.rimPower },
  };
  material.userData.fishTint = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_UNIFORMS}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${GLSL_TINT}`);
  };
  material.customProgramCacheKey = () => 'fish-tint-v1';
  return material;
}
