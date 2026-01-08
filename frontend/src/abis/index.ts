import PoB_01ABI from './PoB_01.json';
import PoB_02_v001_ABI from './PoB_02_v001.json';
import JurySC_01_v001_ABI from './JurySC_01_v001.json';
import JurySC_01_v002_ABI from './JurySC_01_v002.json';

// Alias latest version as default export
const JurySC_01ABI = JurySC_01_v002_ABI;
const PoB_02ABI = PoB_02_v001_ABI;

export {
  JurySC_01ABI,  // Latest version (alias for v002)
  PoB_01ABI,     // PoB version 01 (legacy)
  PoB_02ABI,     // PoB version 02 (latest)
  PoB_02_v001_ABI,
  JurySC_01_v001_ABI,  // Version 001 (legacy)
  JurySC_01_v002_ABI,  // Version 002 (dual voting modes)
};
