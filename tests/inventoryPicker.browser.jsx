import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import InventoryPicker from '../src/modules/challan/InventoryPicker.jsx';

function Harness() {
  const [inventory, setInventory] = useState(window.__inventoryRows ?? []);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    const update = event => setInventory(event.detail);
    window.addEventListener('inventory-fixture-update', update);
    return () => window.removeEventListener('inventory-fixture-update', update);
  }, []);
  return <main>
    <InventoryPicker value={selected?.sku ?? ''} inventoryId={selected?.id ?? ''}
      inventory={inventory} onChange={() => {}} onSelect={setSelected} />
    <output data-testid="selected-physical-id">{selected?.id ?? ''}</output>
  </main>;
}
createRoot(document.getElementById('root')).render(<Harness />);