import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker

output_dir = "sources/crypto-design"
os.makedirs(output_dir, exist_ok=True)

# --- Palette (validated categorical order, light mode) ---
BLUE = "#2a78d6"
ORANGE = "#eb6834"
AQUA = "#1baf7a"
YELLOW = "#eda100"
INK = "#0b0b0b"
INK_SECOND = "#52514e"
INK_MUTED = "#898781"
GRID = "#e1e0d9"
SURFACE = "#fcfcfb"

plt.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["DejaVu Sans", "Arial", "Helvetica"],
    "axes.edgecolor": GRID,
    "axes.labelcolor": INK_SECOND,
    "text.color": INK,
    "xtick.color": INK_SECOND,
    "ytick.color": INK_SECOND,
    "figure.facecolor": SURFACE,
    "axes.facecolor": SURFACE,
    "savefig.facecolor": SURFACE,
})

# --- Empirical results, transcribed from Computation_Overhead_Analysis.ipynb ---
# Dataset: 2,000,000 rows / 94.76 MB, extrapolated from a 1,000-record sample (2000x)
key_lengths = [1024, 2048, 3072]

storage_gb = {
    "Plaintext":  [94.76 / 1024] * 3,
    "RSA":        [0.24, 0.49, 0.73],
    "PHE (Paillier)": [0.54, 1.01, 1.50],
    "FHE (CKKS)": [150.73, 617.25, 617.23],
}
enc_latency_hr = {
    "Plaintext":  [0.0, 0.0, 0.0],
    "RSA":        [0.01, 0.01, 0.04],
    "PHE (Paillier)": [4.97, 34.99, 112.10],
    "FHE (CKKS)": [0.69, 1.76, 1.77],
}
analytics_latency_min = {
    "Plaintext":  [0.004901 / 60] * 3,
    "RSA":        [2.82, 17.77, 112.31],
    "PHE (Paillier)": [1.47, 4.99, 10.53],
    "FHE (CKKS)": [0.77, 1.46, 1.45],
}

protocols = ["Plaintext", "RSA", "PHE (Paillier)", "FHE (CKKS)"]
colors = {"Plaintext": INK_MUTED, "RSA": ORANGE, "PHE (Paillier)": BLUE, "FHE (CKKS)": AQUA}


def grouped_bar_log(data, ylabel, title, filename, value_fmt="{:.2f}"):
    fig, ax = plt.subplots(figsize=(8, 5), dpi=200)
    n_groups = len(key_lengths)
    n_bars = len(protocols)
    bar_w = 0.19
    x = np.arange(n_groups)

    for i, proto in enumerate(protocols):
        vals = data[proto]
        offset = (i - (n_bars - 1) / 2) * bar_w
        bars = ax.bar(x + offset, vals, width=bar_w * 0.92, color=colors[proto],
                       label=proto, zorder=3)
        for rect, v in zip(bars, vals):
            if v <= 0:
                continue
            ax.text(rect.get_x() + rect.get_width() / 2, v * 1.15,
                    value_fmt.format(v), ha="center", va="bottom",
                    fontsize=7.5, color=INK_SECOND)

    ax.set_yscale("log")
    ax.set_xticks(x)
    ax.set_xticklabels([f"{k}-bit" for k in key_lengths])
    ax.set_xlabel("Key Length")
    ax.set_ylabel(ylabel)
    ax.set_title(title, color=INK, fontsize=13, pad=14)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"{v:g}"))
    ax.grid(axis="y", color=GRID, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)
    for spine in ["left", "bottom"]:
        ax.spines[spine].set_color(GRID)
    ax.legend(frameon=False, loc="upper left", fontsize=9, ncols=2)
    fig.tight_layout()
    out_path = os.path.join(output_dir, filename)
    fig.savefig(out_path)
    plt.close(fig)
    print(f"saved {out_path}")


grouped_bar_log(
    storage_gb,
    ylabel="Storage Footprint (GB, log scale)",
    title="Ciphertext Storage Footprint vs. Plaintext Baseline\n(2M-record financial dataset, extrapolated)",
    filename="chart-storage-footprint.png",
)

grouped_bar_log(
    enc_latency_hr,
    ylabel="Encryption Latency (hours, log scale)",
    title="Full-Dataset Encryption Latency by Cryptosystem",
    filename="chart-encryption-latency.png",
)

grouped_bar_log(
    analytics_latency_min,
    ylabel="Analytics Latency (minutes, log scale)",
    title="Sum/Average Computation Latency on Ciphertext",
    filename="chart-analytics-latency.png",
)


# --- Trade-off scatter: storage vs. analytics latency, bubble = key length ---
fig, ax = plt.subplots(figsize=(7.5, 5.5), dpi=200)
size_map = {1024: 220, 2048: 480, 3072: 820}

for proto in ["RSA", "PHE (Paillier)", "FHE (CKKS)"]:
    xs = analytics_latency_min[proto]
    ys = storage_gb[proto]
    sizes = [size_map[k] for k in key_lengths]
    ax.scatter(xs, ys, s=sizes, color=colors[proto], alpha=0.75,
               edgecolors="white", linewidths=1.2, label=proto, zorder=3)
    for x, y, k in zip(xs, ys, key_lengths):
        ax.annotate(f"{k}", (x, y), textcoords="offset points", xytext=(0, 0),
                    ha="center", va="center", fontsize=7, color="white", fontweight="bold")

ax.set_xscale("log")
ax.set_yscale("log")
ax.set_xlabel("Analytics Latency (minutes, log scale)")
ax.set_ylabel("Storage Footprint (GB, log scale)")
ax.set_title("Cryptosystem Trade-off Space\n(bubble size = key length; label = bit length)",
             color=INK, fontsize=13, pad=14)
ax.grid(True, which="both", color=GRID, linewidth=0.7, zorder=0)
ax.set_axisbelow(True)
for spine in ["top", "right"]:
    ax.spines[spine].set_visible(False)
for spine in ["left", "bottom"]:
    ax.spines[spine].set_color(GRID)
ax.legend(frameon=False, loc="upper left", fontsize=9)
fig.tight_layout()
out_path = os.path.join(output_dir, "chart-tradeoff-scatter.png")
fig.savefig(out_path)
plt.close(fig)
print(f"saved {out_path}")

print("\nAll charts generated successfully.")
