"""B0 target app: a desktop window showing the wall clock in milliseconds, for glass-to-glass latency readings."""
import time
import tkinter as tk

root = tk.Tk()
root.title("gg-cast clock")
import sys
root.geometry(sys.argv[1] if len(sys.argv) > 1 else "640x240+80+80")
label = tk.Label(root, font=("Menlo", 64), fg="#111", bg="#fff")
label.pack(expand=True, fill="both")
clicks = tk.Label(root, font=("Menlo", 18), fg="#06c", bg="#fff", text="clicks 0")
clicks.pack(fill="x")
count = 0


def tick():
    label.config(text=f"{int(time.time() * 1000) % 100000:05d}")
    root.after(8, tick)


def click(_event):
    global count
    count += 1
    clicks.config(text=f"clicks {count}")


root.bind("<Button-1>", click)
tick()
root.mainloop()
