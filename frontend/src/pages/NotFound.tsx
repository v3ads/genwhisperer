import { Link } from "react-router-dom";
import { Brand } from "../components/Brand";

export default function NotFound() {
  return (
    <div className="center-screen">
      <div style={{ textAlign: "center", padding: 24 }}>
        <div style={{ display: "inline-block", marginBottom: 18 }}><Brand large /></div>
        <h1 style={{ fontSize: 64, lineHeight: 1, margin: "0 0 8px" }}>404</h1>
        <p style={{ color: "var(--text-dim)", margin: "0 0 22px" }}>That page doesn't exist.</p>
        <Link className="btn btn-primary" style={{ width: "auto", display: "inline-flex" }} to="/">Back home</Link>
      </div>
    </div>
  );
}
