(function(){

  function initRoxGrid(){

    var hero=document.querySelector(".rox-showcase-hero");
    if(!hero) return;

    var targetX=0;
    var targetY=0;
    var currentX=0;
    var currentY=0;

    hero.addEventListener("mousemove",function(e){

      var r=hero.getBoundingClientRect();

      var px=(e.clientX-r.left)/r.width;
      var py=(e.clientY-r.top)/r.height;

      targetX=(px-.5)*8;
      targetY=(py-.5)*-6;

      hero.style.setProperty("--rox-pointer-x",(px*100)+"%");
      hero.style.setProperty("--rox-pointer-y",(py*100)+"%");
    });

    hero.addEventListener("mouseleave",function(){
      targetX=0;
      targetY=0;

      hero.style.setProperty("--rox-pointer-x","50%");
      hero.style.setProperty("--rox-pointer-y","50%");
    });

    function animate(){

      currentX+=(targetX-currentX)*.075;
      currentY+=(targetY-currentY)*.075;

      hero.style.setProperty("--rox-grid-x",currentX+"deg");
      hero.style.setProperty("--rox-grid-y",currentY+"deg");

      requestAnimationFrame(animate);
    }

    animate();
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",initRoxGrid);
  }else{
    initRoxGrid();
  }

})();
