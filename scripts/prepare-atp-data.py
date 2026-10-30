#!/usr/bin/env python3
"""Rebuild the small ATP structure asset from original RCSB coordinates.

Python 3 standard library only. Usage:
  python3 scripts/prepare-atp-data.py
  python3 scripts/prepare-atp-data.py --source /path/to/6OQR.cif
  python3 scripts/prepare-atp-data.py --source /path/to/6OQR.cif --check

The source digest is pinned. A changed PDB revision requires deliberate review.
No application code or coordinates are copied from a third-party visualization.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import urllib.request

SOURCE = "https://files.rcsb.org/download/6OQR.cif"
SHA256 = "f69f53bec1acc5a306ea45f30ce541b35a07a6fa0a4de25e45f56259110b4851"
ROOT = Path(__file__).resolve().parents[1]
ENTITIES = {
    "1": ("ATP synthase subunit delta", "stator"),
    "2": ("ATP synthase subunit alpha", "head"),
    "3": ("ATP synthase subunit b", "stator"),
    "4": ("ATP synthase epsilon chain", "rotor"),
    "5": ("ATP synthase gamma chain", "rotor"),
    "6": ("ATP synthase subunit beta", "head"),
    "7": ("ATP synthase subunit c", "rotor"),
    "8": ("ATP synthase subunit a", "stator"),
}


class Quoted(str):
    """Retain quoting so e.g. a revision's '_citation.title' is a value."""


def tokens(text):
    """Tokenize the quoted, unquoted and semicolon text forms in PDBx/mmCIF."""
    lines = iter(text.splitlines())
    for line in lines:
        if line.startswith(";"):
            block = [line[1:]]
            for continuation in lines:
                if continuation.startswith(";"):
                    break
                block.append(continuation)
            else:
                raise ValueError("Unterminated mmCIF text field")
            yield Quoted("\n".join(block))
            continue
        position = 0
        while position < len(line):
            if line[position].isspace():
                position += 1
                continue
            if line[position] == "#":
                break
            start = position
            quote = line[position] if line[position] in "\"'" else None
            position += 1
            if quote:
                while position < len(line):
                    if line[position] == quote and (position + 1 == len(line) or line[position + 1].isspace()):
                        yield Quoted(line[start + 1:position])
                        position += 1
                        break
                    position += 1
                else:
                    raise ValueError("Unterminated mmCIF quoted field")
            else:
                while position < len(line) and not line[position].isspace():
                    position += 1
                yield line[start:position]


def parse_cif(text):
    stream = list(tokens(text))
    result = {}
    index = 0
    while index < len(stream):
        token = stream[index]
        index += 1
        if token == "loop_":
            names = []
            while index < len(stream) and not isinstance(stream[index], Quoted) and stream[index].startswith("_"):
                names.append(stream[index])
                index += 1
            values = []
            while index < len(stream) and (isinstance(stream[index], Quoted) or not (stream[index].startswith("_") or stream[index] in ("loop_", "stop_") or stream[index].startswith("data_"))):
                values.append(stream[index])
                index += 1
            if not names or len(values) % len(names):
                raise ValueError("Malformed mmCIF loop")
            for offset, name in enumerate(names):
                result[name] = values[offset::len(names)]
        elif token.startswith("_"):
            result[token] = [stream[index]]
            index += 1
    return result


def rows(cif, category):
    names = [name for name in cif if name.startswith(category + ".")]
    return [dict(zip((name.split(".", 1)[1] for name in names), values))
            for values in zip(*(cif[name] for name in names))]


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def sub(a, b):
    return [x - y for x, y in zip(a, b)]


def cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


def normalize(a):
    length = math.sqrt(dot(a, a))
    if length < 1e-12:
        raise ValueError("Degenerate orientation")
    return [x / length for x in a]


def mean(points):
    return [sum(point[i] for point in points) / len(points) for i in range(3)]


def plane_normal(points):
    """Smallest covariance eigenvector, Jacobi rotations on a symmetric 3x3."""
    centre = mean(points)
    centred = [sub(point, centre) for point in points]
    matrix = [[sum(p[i]*p[j] for p in centred)/len(points) for j in range(3)] for i in range(3)]
    vectors = [[1.0 if i == j else 0.0 for j in range(3)] for i in range(3)]
    for _ in range(64):
        r, s = max(((0, 1), (0, 2), (1, 2)), key=lambda pair: abs(matrix[pair[0]][pair[1]]))
        if abs(matrix[r][s]) < 1e-13:
            break
        theta = 0.5 * math.atan2(2*matrix[r][s], matrix[s][s]-matrix[r][r])
        c, t = math.cos(theta), math.sin(theta)
        rr, ss, rs = matrix[r][r], matrix[s][s], matrix[r][s]
        for k in range(3):
            if k != r and k != s:
                kr, ks = matrix[k][r], matrix[k][s]
                matrix[k][r] = matrix[r][k] = c*kr-t*ks
                matrix[k][s] = matrix[s][k] = t*kr+c*ks
        matrix[r][r] = c*c*rr-2*c*t*rs+t*t*ss
        matrix[s][s] = t*t*rr+2*c*t*rs+c*c*ss
        matrix[r][s] = matrix[s][r] = 0.0
        for k in range(3):
            kr, ks = vectors[k][r], vectors[k][s]
            vectors[k][r], vectors[k][s] = c*kr-t*ks, t*kr+c*ks
    smallest = min(range(3), key=lambda i: matrix[i][i])
    return normalize([vectors[k][smallest] for k in range(3)])


def prepare(raw):
    digest = hashlib.sha256(raw).hexdigest()
    if digest != SHA256:
        raise ValueError(f"Source revision changed: expected {SHA256}, received {digest}")
    cif = parse_cif(raw.decode("utf-8"))
    if cif["_entry.id"] != ["6OQR"]:
        raise ValueError("Not the requested structure")
    entities = {row["id"]: row for row in rows(cif, "_entity")}
    for entity_id, (description, _) in ENTITIES.items():
        if entities[entity_id]["pdbx_description"] != description or entities[entity_id]["type"] != "polymer":
            raise ValueError("Unexpected source entity identity")
    assembly = rows(cif, "_pdbx_struct_assembly")
    generators = rows(cif, "_pdbx_struct_assembly_gen")
    operations = rows(cif, "_pdbx_struct_oper_list")
    if len(assembly) != 1 or assembly[0]["id"] != "1" or assembly[0]["oligomeric_count"] != "22":
        raise ValueError("Unexpected biological assembly")
    if len(generators) != 1 or generators[0]["assembly_id"] != "1" or generators[0]["oper_expression"] != "1":
        raise ValueError("Assembly requires a different expansion")
    if len(operations) != 1 or operations[0]["id"] != "1":
        raise ValueError("Unexpected assembly operators")
    operation = operations[0]
    for i in range(1, 4):
        if float(operation[f"vector[{i}]"]) != 0:
            raise ValueError("Non-identity assembly translation")
        for j in range(1, 4):
            if float(operation[f"matrix[{i}][{j}]"]) != (1 if i == j else 0):
                raise ValueError("Non-identity assembly rotation")
    assembly_ids = set(generators[0]["asym_id_list"].split(","))
    chains = {}
    residues = set()
    for atom in rows(cif, "_atom_site"):
        if atom["group_PDB"] != "ATOM" or atom["label_atom_id"] != "CA" or atom["pdbx_PDB_model_num"] != "1":
            continue
        label = atom["label_asym_id"]
        entity = atom["label_entity_id"]
        if label not in assembly_ids or entity not in ENTITIES:
            continue
        # The pinned source has no alternate CA positions. Do not silently choose one.
        if atom["label_alt_id"] != ".":
            raise ValueError("Alternate alpha-carbon requires explicit policy")
        key = (label, atom["label_seq_id"])
        if key in residues:
            raise ValueError("Duplicate alpha carbon")
        residues.add(key)
        chain = chains.setdefault(atom["auth_asym_id"], {"label": label, "entity": entity, "points": [], "residues": []})
        if chain["entity"] != entity or chain["label"] != label:
            raise ValueError("Ambiguous source chain mapping")
        chain["points"].append([float(atom[f"Cartn_{axis}"]) for axis in "xyz"])
        chain["residues"].append(atom["auth_seq_id"])
    if len(chains) != 22 or len(residues) != 4849:
        raise ValueError(f"Unexpected CA selection: {len(chains)} chains, {len(residues)} positions")

    ring = [mean(chain["points"]) for chain in chains.values() if chain["entity"] == "7"]
    if len(ring) != 10:
        raise ValueError("Expected the E. coli ten-subunit c ring")
    origin = mean(ring)
    y_axis = plane_normal(ring)
    head = mean([p for chain in chains.values() if chain["entity"] in ("2", "6") for p in chain["points"]])
    if dot(y_axis, sub(head, origin)) < 0:
        y_axis = [-v for v in y_axis]
    # Preserve a reproducible azimuth: project original +X into the ring plane.
    x_axis = normalize(sub([1.0, 0.0, 0.0], [y_axis[0]*v for v in y_axis]))
    z_axis = normalize(cross(x_axis, y_axis))
    rotation = [x_axis, y_axis, z_axis]
    def transform(p):
        return [round(dot(row, sub(p, origin)), 4) for row in rotation]
    output = []
    metadata = []
    samples = []
    for chain_id, chain in chains.items():
        description, component = ENTITIES[chain["entity"]]
        output.append({"id": chain_id, "name": description, "component": component,
                       "points": [n for point in chain["points"] for n in transform(point)]})
        metadata.append({"authChain": chain_id, "labelChain": chain["label"], "entity": chain["entity"],
                         "name": description, "component": component, "alphaCarbons": len(chain["points"])})
        samples.append({"chain": chain_id, "residue": chain["residues"][0], "source": chain["points"][0],
                        "transformed": transform(chain["points"][0])})
    anchors = {component: transform(mean([p for chain in chains.values() if ENTITIES[chain["entity"]][1] == component for p in chain["points"]]))
               for component in ("rotor", "stator", "head")}
    # Ring location is more informative than the combined shaft+ring centroid.
    anchors["rotor"] = [0.0, 0.0, 0.0]
    anchors["membrane"] = [0.0, 0.0, 0.0]
    asset = {"schema": "atp-structure-v1", "pdb": "6OQR", "units": "angstrom", "source": SOURCE,
             "sha256": digest, "representation": "Deposited model 1, biological assembly 1; one CA point per modeled protein residue. Static snapshot, not a molecular surface or a motion simulation.",
             "chains": output, "anchors": anchors}
    provenance = {"sourceSha256": digest, "assembly": 1, "assemblyOperation": "identity", "sourceVersion": "1.4",
                  "originAngstrom": origin, "rotationRows": rotation, "roundingDecimalPlaces": 4,
                  "alphaCarbons": len(residues), "chains": metadata, "sourceSamples": samples}
    readme = """# 6OQR structural asset provenance

Source: https://files.rcsb.org/download/6OQR.cif (RCSB PDB entry revision 1.4).
Structure: *E. coli ATP Synthase ADP State 1a*, deposited by A. G. Stewart,
J. L. Walshe and M. Sobti; https://doi.org/10.2210/pdb6OQR/pdb.
Primary study: Sobti et al. (2020), *Cryo-EM structures provide insight into how
E. coli F1Fo ATP synthase accommodates symmetry mismatch*, Nature Communications
11, 2615; https://doi.org/10.1038/s41467-020-16387-2.
PDB archive coordinates are CC0: https://www.rcsb.org/pages/policies.
This converter, grouping, text and display transform were prepared independently;
no coordinates or application code came from the reference visualization.

## Representation and biological assembly

The file contains the 22 protein chains of author-defined biological assembly 1.
Its one assembly operation is the identity, so no symmetry copies are generated.
Author chain IDs are retained; mmCIF label IDs and entity identities are recorded
below. The c ring has ten chains. Rotor = c/gamma/epsilon; stator = a/b/delta;
head = alpha/beta. The head is held against rotation by the stator, but its beta
subunits undergo conformational changes during catalysis. Grouping does not mean
every atom of a group is mechanically rigid.

Only deposited model-1 ATOM CA positions are included. Hydrogens, side chains,
ligands (including nucleotides/ions), solvent and unmodeled residues are omitted.
No coordinates were interpolated or invented. A point is an alpha-carbon position,
not a complete atomistic residue, density surface, or independently resolved atom.
Do not connect points across missing sequence positions as though that gap were
observed. The ADP-state experimental snapshot is always static; the app's separate
mechanism diagram does not animate these coordinates into an active conformation.

## Display transform

All distances remain in angstroms. Let C be the equally weighted mean of the ten
c-subunit CA centroids. Fit a least-squares plane to those ten centroids and use its
unit normal as +Y, with its sign chosen toward the alpha/beta head. Project original
+X into that plane for display +X; display +Z = X cross Y. For a source column vector
p, the display vector is **R (p - C)**, rounded to four decimals. This is a rigid,
right-handed orientation/translation; it is not a scale fit or molecular deformation.
The gray membrane is illustrative, centered at the c-ring reference y=0; its displayed
width/thickness are not measured lipid boundaries. Positive Y faces the catalytic
head (cytoplasmic side in this bacterium); negative Y faces the periplasmic side.
The source coordinates do not independently determine a membrane slab or proton path.

## Reproduce

Run `python3 scripts/prepare-atp-data.py` from the repository (standard library
only), or pass `--source /path/to/6OQR.cif` for an already downloaded original.
Use `--check` to compare generated files without writing. A pinned source SHA-256
prevents an archive revision from silently changing the asset. The full transform,
chain counts and one independent source sample per chain follow for auditing.

```json
""" + json.dumps(provenance, indent=2) + "\n```\n"
    return json.dumps(asset, separators=(",", ":")) + "\n", readme


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    raw = args.source.read_bytes() if args.source else urllib.request.urlopen(SOURCE, timeout=60).read()
    asset, readme = prepare(raw)
    paths = [(ROOT / "public/models/atp-6oqr.json", asset), (ROOT / "public/models/atp-6oqr.README.md", readme)]
    for path, content in paths:
        if args.check:
            if not path.exists() or path.read_text() != content:
                raise SystemExit(f"Out of date: {path}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
    print(f"{'Verified' if args.check else 'Prepared'} 6OQR: {len(asset.encode())} bytes")


if __name__ == "__main__":
    main()
