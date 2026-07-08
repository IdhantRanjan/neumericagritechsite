#!/usr/bin/env python3
"""
A2 — label-permutation negative control for backtest v2.

The engine never sees labels (they only enter at scoring), so the correct
permutation test shuffles the stress/control assignment across the 37 scored
units and recomputes each headline statistic under the null that labels are
exchangeable. If the observed statistic is not cl