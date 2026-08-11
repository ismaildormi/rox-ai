(function(){
  function roxCleanWelcome(){
    var el=document.getElementById("heroGreeting");
    if(!el) return;

    var raw=(el.textContent||"").trim();

    var name=raw
      .replace(/^Welcome,\s*/i,"")
      .replace(/[!,.]+$/g,"")
      .replace(/[^\p{L}\p{N}_\-. ]+$/gu,"")
      .trim();

    if(!name){
      name="Rox User";
    }

    var clean="Welcome, "+name;

    if(el.textContent!==clean){
      el.textContent=clean;
    }
  }

  function start(){
    roxCleanWelcome();

    var target=document.getElementById("heroGreeting");
    if(!target) return;

    new MutationObserver(function(){
      roxCleanWelcome();
    }).observe(target,{
      childList:true,
      characterData:true,
      subtree:true
    });
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",start);
  }else{
    start();
  }
})();
