import PoB_01ABI from './PoB_01.json';
import PoB_02_v001_ABI from './PoB_02_v001.json';
import PoB_03_v001_ABI from './PoB_03_v001.json';
import JurySC_01_v001_ABI from './JurySC_01_v001.json';
import JurySC_01_v002_ABI from './JurySC_01_v002.json';
import JurySC_03_v001_ABI from './JurySC_03_v001.json';
import IVersionAdapterABI from './IVersionAdapter.json';
import PoBRegistryABI from './PoBRegistry.json';
import CertNFTABI from './CertNFT.json';
import CertGateABI from './CertGate.json';

// ============================================================================
// Combined Write ABIs
// ============================================================================

/**
 * Merge multiple ABI arrays, deduplicating by function signature.
 * Only keeps 'function' entries (no events, errors, constructors).
 */
function mergeABIs(...abis: any[][]): any[] {
  const seen = new Set<string>();
  const merged: any[] = [];
  for (const abi of abis) {
    for (const entry of abi) {
      if (entry.type !== 'function') continue;
      const key = `${entry.name}(${(entry.inputs || []).map((i: any) => i.type).join(',')})`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(entry);
      }
    }
  }
  return merged;
}

/** Combined JurySC write ABI: all function signatures from all JurySC versions */
const JurySCWriteAllABI = mergeABIs(
  JurySC_01_v001_ABI, JurySC_01_v002_ABI, JurySC_03_v001_ABI
);

/** Combined PoB write ABI: all function signatures from all PoB versions */
const PoBWriteAllABI = mergeABIs(
  PoB_01ABI, PoB_02_v001_ABI, PoB_03_v001_ABI
);

export {
  // Adapter system
  IVersionAdapterABI,
  PoBRegistryABI,
  JurySCWriteAllABI,
  PoBWriteAllABI,

  // Individual version ABIs (used by mergeABIs, badge loading)
  PoB_01ABI,
  PoB_02_v001_ABI,
  PoB_03_v001_ABI,
  JurySC_01_v001_ABI,
  JurySC_01_v002_ABI,
  JurySC_03_v001_ABI,

  // Certificate system
  CertNFTABI,
  CertGateABI,
};
