(function(){
  'use strict';
  const store=window.ItajaoStore;
  const params=new URLSearchParams(location.search);
  const id=params.get('subscription')||'';
  const token=params.get('token')||'';
  const $=value=>document.getElementById(value);
  let attempts=0;
  let timer=null;

  function dateLabel(value){
    if(!value)return 'Data em confirmação';
    const date=new Date(String(value).length===10?value+'T12:00:00':value);
    if(Number.isNaN(date.getTime()))return 'Data em confirmação';
    return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'long',year:'numeric'}).format(date);
  }

  function planLabel(data){return data.planType==='annual'?'Plano anual · 12 envios':'Plano mensal · renovação mensal'}
  function coffeeLabel(data){return (data.weightGrams===1000?'1kg':'500g')+' · '+(data.coffeeFormat==='ground'?'Moído':'Em grãos')}
  function paymentLabel(data){
    if(data.billingMethod==='pix')return data.planType==='annual'?'PIX anual · 5% OFF':'PIX mensal · 5% OFF';
    return data.planType==='annual'?'12 cobranças mensais':'Cobrança mensal recorrente';
  }

  function paintShipments(shipments){
    const host=$('shipmentTimeline');
    host.innerHTML='';
    (shipments||[]).slice(0,12).forEach(shipment=>{
      const item=document.createElement('li');
      const reward=shipment.reward_code?' · surpresa do Clube Itajaó':'';
      const title=document.createElement('strong');
      title.textContent=shipment.shipment_number+'º envio · '+dateLabel(shipment.scheduled_for);
      item.appendChild(title);
      item.appendChild(document.createTextNode(String(shipment.status||'planejado').replace('_',' ')+reward));
      host.appendChild(item);
    });
    host.hidden=!host.children.length;
  }

  function paint(data){
    $('statusDetails').hidden=false;
    $('statusNumber').textContent=data.subscriptionNumber||String(data.id||'').slice(0,8).toUpperCase();
    $('statusLabel').textContent=data.statusLabel||'Em processamento';
    $('statusPlan').textContent=planLabel(data);
    $('statusCoffee').textContent=coffeeLabel(data);
    $('statusPayment').textContent=paymentLabel(data);
    $('statusBenefitCard').hidden=!data.benefitCode;
    if(data.benefitCode)$('statusBenefit').textContent=data.benefitCode;
    paintShipments(data.shipments);

    if(data.status==='active'||data.status==='completed'){
      $('statusIcon').textContent='✓';
      $('statusEyebrow').textContent='Bem-vindo ao Clube Itajaó';
      $('statusTitle').textContent=data.status==='completed'?'Seu ciclo foi concluído.':'Sua assinatura está ativa!';
      $('statusCopy').textContent='Pagamento confirmado. Vamos cuidar do seu café e dos próximos envios, sempre com frete grátis.';
      $('statusMessage').textContent='Guarde este link para acompanhar os envios da sua assinatura.';
      $('statusMessage').className='club-message success';
      if(timer)clearInterval(timer);
    }else if(['cancelled','checkout_error','refunded'].includes(data.status)){
      $('statusIcon').textContent='!';
      $('statusEyebrow').textContent='Pagamento não concluído';
      $('statusTitle').textContent='Sua assinatura ainda não foi ativada.';
      $('statusCopy').textContent='Nenhum novo pagamento deve ser feito antes de conferir a situação com a equipe Itajaó.';
      $('statusMessage').textContent='Fale com a gente para receber orientação segura.';
      $('statusMessage').className='club-message error';
      if(timer)clearInterval(timer);
    }else{
      $('statusIcon').textContent='···';
      $('statusEyebrow').textContent='Confirmação em andamento';
      $('statusTitle').textContent='Seu pagamento está sendo confirmado.';
      $('statusCopy').textContent='O Mercado Pago pode levar alguns instantes para concluir. Não inicie outro pagamento.';
      $('statusMessage').textContent='Esta página será atualizada automaticamente.';
      $('statusMessage').className='club-message info';
    }
  }

  async function check(){
    if(!id||!token){
      $('statusIcon').textContent='!';
      $('statusEyebrow').textContent='Link incompleto';
      $('statusTitle').textContent='Assinatura não identificada.';
      $('statusCopy').textContent='Use o link recebido após o pagamento ou fale com a equipe Itajaó.';
      return;
    }
    attempts++;
    try{
      const data=await store.api('subscription-status',{id,token});
      paint(data);
    }catch(_){
      if(attempts>2){
        $('statusIcon').textContent='···';
        $('statusEyebrow').textContent='Confirmação pendente';
        $('statusTitle').textContent='Ainda estamos consultando sua assinatura.';
        $('statusCopy').textContent='Se você já pagou, não faça outro pagamento. Tente novamente em alguns instantes.';
      }
    }
    if(attempts>=60&&timer)clearInterval(timer);
  }

  $('statusBenefit').addEventListener('click',async()=>{
    const code=$('statusBenefit').textContent.trim();
    if(!code||code==='—')return;
    try{
      await navigator.clipboard.writeText(code);
      $('statusBenefit').textContent='COPIADO';
      setTimeout(()=>{$('statusBenefit').textContent=code},1600);
    }catch(_){}
  });

  check();
  timer=setInterval(check,5000);
})();
