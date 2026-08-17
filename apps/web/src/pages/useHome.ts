import { HomeContext } from "./HomeProvider";
import { useContext } from "react";

export function useHome() {
  const home = useContext(HomeContext);
  if (home === null) {
    throw new Error('Home context not found');
  }
  return home;
}