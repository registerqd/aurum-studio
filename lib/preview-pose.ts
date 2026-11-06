"use client";

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

export const HOME_PREVIEW_ROTATION_X = degreesToRadians(20);
export const HOME_PREVIEW_ROTATION_Y = degreesToRadians(25);
export const HOME_PREVIEW_INTRO_ROTATION_X = 0;
export const HOME_PREVIEW_SPIN_RADIANS = Math.PI * 2;
export const HOME_PREVIEW_ZOOM_DURATION_MS = 760;
