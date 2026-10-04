import { Link } from "react-router-dom";
import { useBusinessAvailability } from "../../hooks/useBusinessAvailability.js";
import BusinessReset from "./BusinessReset";
import "./adminSettings.css";
export default function DangerZone() {
  const { record } = useBusinessAvailability();
  return (
    <section className="admin-settings danger-zone-page">
      <Link className="settings-back" to="/dashboard/admin-settings">
        ← Settings
      </Link>
      <header>
        <h2>Danger Zone</h2>
        <p>Sensitive business data actions. Administrator access only.</p>
      </header>
      <BusinessReset state={record} />
    </section>
  );
}
