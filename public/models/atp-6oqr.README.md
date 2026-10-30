# 6OQR structural asset provenance

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
{
  "sourceSha256": "f69f53bec1acc5a306ea45f30ce541b35a07a6fa0a4de25e45f56259110b4851",
  "assembly": 1,
  "assemblyOperation": "identity",
  "sourceVersion": "1.4",
  "originAngstrom": [
    222.29323098086124,
    235.61070399863297,
    209.34655625427203
  ],
  "rotationRows": [
    [
      0.8265058220572634,
      -0.5301494654623046,
      -0.18928726944905724
    ],
    [
      -0.5629281713553224,
      -0.7783792712135653,
      -0.27791650551845953
    ],
    [
      0.0,
      0.33625474630861635,
      -0.9417710685643981
    ]
  ],
  "roundingDecimalPlaces": 4,
  "alphaCarbons": 4849,
  "chains": [
    {
      "authChain": "W",
      "labelChain": "A",
      "entity": "1",
      "name": "ATP synthase subunit delta",
      "component": "stator",
      "alphaCarbons": 173
    },
    {
      "authChain": "C",
      "labelChain": "B",
      "entity": "2",
      "name": "ATP synthase subunit alpha",
      "component": "head",
      "alphaCarbons": 512
    },
    {
      "authChain": "B",
      "labelChain": "C",
      "entity": "2",
      "name": "ATP synthase subunit alpha",
      "component": "head",
      "alphaCarbons": 511
    },
    {
      "authChain": "A",
      "labelChain": "D",
      "entity": "2",
      "name": "ATP synthase subunit alpha",
      "component": "head",
      "alphaCarbons": 508
    },
    {
      "authChain": "X",
      "labelChain": "E",
      "entity": "3",
      "name": "ATP synthase subunit b",
      "component": "stator",
      "alphaCarbons": 156
    },
    {
      "authChain": "H",
      "labelChain": "F",
      "entity": "4",
      "name": "ATP synthase epsilon chain",
      "component": "rotor",
      "alphaCarbons": 136
    },
    {
      "authChain": "G",
      "labelChain": "G",
      "entity": "5",
      "name": "ATP synthase gamma chain",
      "component": "rotor",
      "alphaCarbons": 284
    },
    {
      "authChain": "F",
      "labelChain": "H",
      "entity": "6",
      "name": "ATP synthase subunit beta",
      "component": "head",
      "alphaCarbons": 458
    },
    {
      "authChain": "E",
      "labelChain": "I",
      "entity": "6",
      "name": "ATP synthase subunit beta",
      "component": "head",
      "alphaCarbons": 460
    },
    {
      "authChain": "D",
      "labelChain": "J",
      "entity": "6",
      "name": "ATP synthase subunit beta",
      "component": "head",
      "alphaCarbons": 460
    },
    {
      "authChain": "J",
      "labelChain": "K",
      "entity": "7",
      "name": "ATP synthase subunit c",
      "component": "rotor",
      "alphaCarbons": 77
    },
    {
      "authChain": "L",
      "labelChain": "L",
      "entity": "7",
      "name": "ATP synthase subunit c",
      "component": "rotor",
      "alphaCarbons": 77
    },
    {
      "authChain": "M",
      "labelChain": "M",
      "entity": "7",
      "name": "ATP synthase subunit c",
      "component": "rotor",
      "alphaCarbons": 77
    },
    {
      "authChain": "N",
      "labelChain": "N",
      "entity": "7",
      "name": "ATP synthase subunit c",
      "component": "rotor",
      "alphaCarbons": 77
    },
    {
      "authChain": "O",
      "labelChain": "O",
      "entity": "7",
      "name": "ATP synthase subunit c",
      "component": "rotor",
      "alphaCarbons": 77
    },
    {
      "authChain": "P",
      "labelChain": "P",
      "entity": "7",
      "name": "ATP synthase subunit c",
      "component": "rotor",
      "alphaCarbons": 77
    },
    {
      "authChain": "Q",
      "labelChain": "Q",
      "entity": "7",
      "name": "ATP synthase subunit c",
      "component": "rotor",
      "alphaCarbons": 77
    },
    {
      "authChain": "R",
      "labelChain": "R",
      "entity": "7",
      "name": "ATP synthase subunit c",
      "component": "rotor",
      "alphaCarbons": 76
    },
    {
      "authChain": "Y",
      "labelChain": "S",
      "entity": "3",
      "name": "ATP synthase subunit b",
      "component": "stator",
      "alphaCarbons": 156
    },
    {
      "authChain": "a",
      "labelChain": "T",
      "entity": "8",
      "name": "ATP synthase subunit a",
      "component": "stator",
      "alphaCarbons": 266
    },
    {
      "authChain": "I",
      "labelChain": "U",
      "entity": "7",
      "name": "ATP synthase subunit c",
      "component": "rotor",
      "alphaCarbons": 77
    },
    {
      "authChain": "S",
      "labelChain": "V",
      "entity": "7",
      "name": "ATP synthase subunit c",
      "component": "rotor",
      "alphaCarbons": 77
    }
  ],
  "sourceSamples": [
    {
      "chain": "W",
      "residue": "2",
      "source": [
        132.807,
        111.113,
        166.885
      ],
      "transformed": [
        0.0789,
        159.0815,
        -1.8739
      ]
    },
    {
      "chain": "C",
      "residue": "2",
      "source": [
        140.553,
        110.853,
        168.87
      ],
      "transformed": [
        6.2432,
        154.3718,
        -3.8307
      ]
    },
    {
      "chain": "B",
      "residue": "1",
      "source": [
        114.584,
        160.923,
        131.473
      ],
      "transformed": [
        -34.6862,
        140.4103,
        48.225
      ]
    },
    {
      "chain": "A",
      "residue": "4",
      "source": [
        114.466,
        91.046,
        165.874
      ],
      "transformed": [
        -4.2501,
        185.3069,
        -7.6694
      ]
    },
    {
      "chain": "X",
      "residue": "1",
      "source": [
        222.101,
        263.464,
        189.785
      ],
      "transformed": [
        -11.2225,
        -16.1357,
        27.7883
      ]
    },
    {
      "chain": "H",
      "residue": "3",
      "source": [
        181.335,
        215.335,
        210.832
      ],
      "transformed": [
        -23.3842,
        38.4259,
        -8.2167
      ]
    },
    {
      "chain": "G",
      "residue": "1",
      "source": [
        168.757,
        142.412,
        178.188
      ],
      "transformed": [
        11.0592,
        111.3405,
        -1.9943
      ]
    },
    {
      "chain": "F",
      "residue": "2",
      "source": [
        148.893,
        103.117,
        142.471
      ],
      "transformed": [
        22.2344,
        163.0352,
        18.4298
      ]
    },
    {
      "chain": "E",
      "residue": "0",
      "source": [
        108.443,
        122.577,
        176.673
      ],
      "transformed": [
        -27.9884,
        161.1531,
        -7.2371
      ]
    },
    {
      "chain": "D",
      "residue": "0",
      "source": [
        154.526,
        87.139,
        195.705
      ],
      "transformed": [
        25.2844,
        157.5066,
        -37.0771
      ]
    },
    {
      "chain": "J",
      "residue": "3",
      "source": [
        232.089,
        271.511,
        206.905
      ],
      "transformed": [
        -10.4741,
        -32.7798,
        14.371
      ]
    },
    {
      "chain": "L",
      "residue": "3",
      "source": [
        240.75,
        264.76,
        201.868
      ],
      "transformed": [
        1.2167,
        -31.0006,
        16.8447
      ]
    },
    {
      "chain": "M",
      "residue": "3",
      "source": [
        228.579,
        269.691,
        215.097
      ],
      "transformed": [
        -13.9609,
        -31.664,
        6.0441
      ]
    },
    {
      "chain": "N",
      "residue": "3",
      "source": [
        240.008,
        254.959,
        233.516
      ],
      "transformed": [
        -0.1911,
        -31.7495,
        -16.2561
      ]
    },
    {
      "chain": "O",
      "residue": "3",
      "source": [
        249.4,
        251.293,
        229.251
      ],
      "transformed": [
        10.3223,
        -32.9977,
        -13.4722
      ]
    },
    {
      "chain": "P",
      "residue": "3",
      "source": [
        250.336,
        250.268,
        220.683
      ],
      "transformed": [
        13.2611,
        -30.3456,
        -5.7477
      ]
    },
    {
      "chain": "Q",
      "residue": "3",
      "source": [
        249.12,
        259.634,
        205.605
      ],
      "transformed": [
        10.1448,
        -32.7609,
        11.6016
      ]
    },
    {
      "chain": "R",
      "residue": "3",
      "source": [
        228.395,
        267.779,
        224.555
      ],
      "transformed": [
        -14.8896,
        -32.7007,
        -3.5061
      ]
    },
    {
      "chain": "Y",
      "residue": "1",
      "source": [
        248.845,
        259.137,
        177.33
      ],
      "transformed": [
        15.5331,
        -24.3612,
        38.0631
      ]
    },
    {
      "chain": "a",
      "residue": "4",
      "source": [
        246.633,
        265.286,
        174.387
      ],
      "transformed": [
        11.002,
        -27.0843,
        42.9024
      ]
    },
    {
      "chain": "I",
      "residue": "3",
      "source": [
        253.539,
        253.986,
        210.962
      ],
      "transformed": [
        15.7774,
        -32.341,
        4.6574
      ]
    },
    {
      "chain": "S",
      "residue": "3",
      "source": [
        230.506,
        262.841,
        232.197
      ],
      "transformed": [
        -11.9735,
        -32.1692,
        -12.3636
      ]
    }
  ]
}
```
