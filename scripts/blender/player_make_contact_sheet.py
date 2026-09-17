import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.image as mpimg
import json,os
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
fig=plt.figure(figsize=(18,10),layout='constrained',facecolor='#f3f3f0');grid=fig.add_gridspec(3,5,height_ratios=[1,1,.58]);frames=[3,6,9,15,24]
for row,(folder,title)in enumerate([('contact-before-dodge','Before: sole contact during retreat'),('contact-after-dodge','After: push-off, flight, landing')]):
 for col,f in enumerate(frames):
  ax=fig.add_subplot(grid[row,col]);im=mpimg.imread(ROOT+'/assets/player-essential-motion/'+folder+'/dodge-'+str(f).zfill(3)+'.png');ax.imshow(im[120:580,140:800]);ax.axis('off');ax.set_title(f'{f/30:.2f} s',fontsize=13)
  if col==0:ax.set_ylabel(title)
audit=json.load(open(ROOT+'/docs/player-footfall-audit.json'));ax=fig.add_subplot(grid[2,:]);
for k,label,color in [('working-dodge','Before','#a34040'),('refined-dodge','After','#286b9b')]:
 fs=audit[k]['frames'];ax.plot([f['t']for f in fs],[100*min(f[s]['soleY']for s in ['Left','Right'])for f in fs],color=color,label=label,lw=2.5)
ax.axvspan(.12,.6,color='#c1a974',alpha=.2,label='Controller retreat');ax.axhline(1.8,color='#888',lw=.8,ls='--');ax.set_xlabel('Time in clip (s)');ax.set_ylabel('Lowest sole clearance (cm)');ax.grid(alpha=.2);ax.legend(loc='upper right',ncols=3);ax.set_xlim(0,.9333);ax.set_ylim(-.8,16)
fig.suptitle('Player dodge — actual skinned character with controller displacement\nSame 0.933 s clip and 1.2 m retreat; floor grid is 0.5 m',fontsize=19,fontweight='bold')
fig.canvas.draw()
for index,label in [(0,'Before: sole contact during retreat'),(5,'After: push-off, flight, landing')]:
 p=fig.axes[index].get_position();fig.text(p.x0,p.y1+.055,label,fontsize=13,fontweight='bold')
fig.savefig(ROOT+'/docs/player-dodge-contact-sheet.png',dpi=170)
