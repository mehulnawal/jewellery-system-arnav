import '../src/index.css';
import { createRoot } from 'react-dom/client';
import { AddModal } from '../src/modules/inventory/Inventory.jsx';

const item = new URLSearchParams(location.search).has('edit')
  ? { id:'physical-edit',type:'HP',shape:'Marquise',size:'5.00',weight:100,box:'B29',
      sku:'5.00_Marquise_HP' } : undefined;
createRoot(document.getElementById('root')).render(
  <AddModal item={item} shapes={['Pan','Marquise','Pear','Round']}
    existingItems={item ? [item] : []} allowDimensions={false}
    onClose={() => {}} onSaved={() => {}} />
);