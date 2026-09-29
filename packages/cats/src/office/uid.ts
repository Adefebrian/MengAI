// One id prefix per mounted scene, so clip paths never collide when two
// offices (a page with the full scene and the hero, a preview) share the
// same crew ids in one document.
import { createContext, useContext } from "react";

export const SceneUid = createContext("of");

export function useSceneUid(): string {
  return useContext(SceneUid);
}

export function sceneClip(uid: string, id: string): string {
  return `${uid}-${id.replace(/[^A-Za-z0-9_-]/g, "")}`;
}
